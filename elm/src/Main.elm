module Main exposing (main)

import Angle exposing (Angle)
import Browser
import Browser.Events
import Camera3d exposing (Camera3d, Projection(..))
import Color
import Direction3d exposing (Direction3d)
import GuanRoute exposing (Segment, segments)
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events as Events
import Length exposing (Meters)
import LineSegment3d exposing (LineSegment3d)
import Pixels
import Point3d exposing (Point3d)
import Quantity
import Scene3d
import Scene3d.Material as Material
import Scene3d.Mesh as Mesh
import Time
import Vector3d


{-| 3D view of the solved Guan's Route, with adjustable elevation
exaggeration, an orbit camera, and a walking animation matching
route-animation.js's SVG version: each segment goes black -> red -> white
in walk order, looping. The camera always looks at the same focal point
(the route's center); the buttons adjust its orientation (rotate
left/right around world-up, angle up/down toward/away from overhead)
around that point, rather than panning or moving the target.
Browser.element rather than Browser.sandbox, since the animation needs a
subscription to drive it.

The camera's orientation is tracked directly as a pair of directions
(`forward`, `up`), not as azimuth/tilt angles recomputed each frame — see
`Orientation` below for why.
-}
type WorldCoordinates
    = WorldCoordinates


{-| Matches route-animation.js's LOOP_SECONDS.
-}
loopDurationMs : Float
loopDurationMs =
    40000


{-| How often the animation clock advances. Deliberately not every
animation frame (~16ms) — rebuilding the walked/current/unwalked meshes is
real work (elm-3d-scene's docs warn against creating meshes in `view`),
and this route has ~1200 segments, so a coarser tick keeps that bounded
to 10/second while still reading as smooth motion.
-}
tickIntervalMs : Float
tickIntervalMs =
    100


{-| How fast pending rotation (queued by button clicks) gets consumed,
in degrees per second.
-}
cameraAnimationSpeed : Float
cameraAnimationSpeed =
    90



-- ORIENTATION
--
-- The camera used to be stored as (azimuth, tilt) angles, with the actual
-- eyePoint/upDirection recomputed from scratch each frame via
-- Camera3d.lookAt. That recomputation takes the camera's forward
-- direction and crosses it against a *fixed* world-up reference to find
-- "right" — which is undefined right at tilt = 90° (forward and world-up
-- become parallel, so the cross product is zero — the same singularity
-- as compass bearing being undefined at the North Pole).
--
-- The fix is to never do that recomputation: track the camera's actual
-- forward/up directions as state, and have every button rotate those
-- *existing* directions by a small increment (via Direction3d.rotateAround,
-- itself a quaternion rotation under the hood) rather than deriving them
-- from an absolute angle pair each time. A rotation applied to an already
-- valid, already-perpendicular (forward, up) pair is always well-defined,
-- including at and through the pole — there's no cross-product-against-a-
-- fixed-reference step left to go degenerate.


type alias Orientation =
    { forward : Direction3d WorldCoordinates
    , up : Direction3d WorldCoordinates
    }


{-| The camera's right direction, as seen from its current orientation.
Always well-defined (never degenerate) because forward and up are
maintained perpendicular to each other as an invariant — perpendicular
vectors never have a zero cross product.
-}
rightOf : Direction3d WorldCoordinates -> Direction3d WorldCoordinates -> Direction3d WorldCoordinates
rightOf forward up =
    -- forward × up. Vector3d.cross's argument order is reversed from
    -- convention (`Vector3d.cross b a` = a × b) — see its doc comment.
    Vector3d.cross (Direction3d.toVector up) (Direction3d.toVector forward)
        |> Vector3d.direction
        |> Maybe.withDefault Direction3d.positiveX


{-| The angle above the horizon `forward` is pointing — 90° straight down,
0° horizontal — recovered from the direction itself rather than tracked
separately, so it stays correct no matter how `forward` got there.
-}
tiltOf : Direction3d WorldCoordinates -> Angle
tiltOf forward =
    Quantity.minus (Direction3d.angleFrom forward Direction3d.negativeZ) (Angle.degrees 90)


{-| Build an orientation from an azimuth/tilt pair, starting from a known
horizontal-looking-north baseline and applying two rotations — used only
to define the three fixed presets (and the initial view), never called
per-frame. Safe at any azimuth/tilt, including tilt = 90°, because it only
ever rotates already-valid direction pairs; it never crosses a direction
against a fixed external reference the way the old per-frame
`Camera3d.lookAt`-based approach did.
-}
orientationFor : Angle -> Angle -> Orientation
orientationFor azimuth tilt =
    let
        forward0 =
            Direction3d.positiveY

        up0 =
            Direction3d.positiveZ

        forward1 =
            Direction3d.rotateAround Direction3d.positiveZ azimuth forward0

        right1 =
            rightOf forward1 up0

        tiltRotation =
            Quantity.negate tilt
    in
    { forward = Direction3d.rotateAround right1 tiltRotation forward1
    , up = Direction3d.rotateAround right1 tiltRotation up0
    }


{-| Split a pending rotation amount into "how much to apply this frame"
and "how much is still left after that" — at most `maxStepDegrees`,
signed to match whichever direction `pending` was headed. This is the
whole animation: no orientation comparison, no derived axis, just a
countdown consumed at a constant rate, so it can't drift or wobble.
-}
consumeStep : Float -> Angle -> ( Angle, Angle )
consumeStep maxStepDegrees pending =
    let
        pendingDegrees =
            Angle.inDegrees pending
    in
    if abs pendingDegrees <= maxStepDegrees then
        ( pending, Angle.degrees 0 )

    else if pendingDegrees > 0 then
        ( Angle.degrees maxStepDegrees, Angle.degrees (pendingDegrees - maxStepDegrees) )

    else
        ( Angle.degrees -maxStepDegrees, Angle.degrees (pendingDegrees + maxStepDegrees) )



-- MODEL


minTilt : Angle
minTilt =
    Angle.degrees 0


maxTilt : Angle
maxTilt =
    Angle.degrees 90


tiltStep : Angle
tiltStep =
    Angle.degrees 10


azimuthStep : Angle
azimuthStep =
    Angle.degrees 15


defaultAzimuth : Angle
defaultAzimuth =
    Angle.degrees 0


defaultTilt : Angle
defaultTilt =
    Angle.degrees 35


{-| "Two clicks up from horizontal and one click rotate left" — a
hand-picked angle that reads well.
-}
camera1Azimuth : Angle
camera1Azimuth =
    Quantity.minus azimuthStep defaultAzimuth


camera1Tilt : Angle
camera1Tilt =
    Quantity.plus minTilt (Quantity.twice tiltStep)


southOrientation : Orientation
southOrientation =
    orientationFor defaultAzimuth defaultTilt


overheadOrientation : Orientation
overheadOrientation =
    orientationFor defaultAzimuth maxTilt


camera1Orientation : Orientation
camera1Orientation =
    orientationFor camera1Azimuth camera1Tilt


type alias Model =
    { exaggeration : Float
    , forward : Direction3d WorldCoordinates
    , up : Direction3d WorldCoordinates
    , pendingAzimuth : Angle
    , pendingTilt : Angle
    , elapsedMs : Float
    , meshes : Meshes
    }


init : Model
init =
    { exaggeration = 3
    , forward = southOrientation.forward
    , up = southOrientation.up
    , pendingAzimuth = Angle.degrees 0
    , pendingTilt = Angle.degrees 0
    , elapsedMs = 0
    , meshes = meshesFor 3 0
    }



-- UPDATE


type Msg
    = SetExaggeration Float
    | SetSouth
    | SetOverhead
    | SetCamera1
    | TiltUp
    | TiltDown
    | RotateLeft
    | RotateRight
    | Tick Time.Posix
    | AnimateCamera Float


{-| Jump straight to a preset — no animation. (Only the four directional
buttons animate; presets snapping instantly is simpler and was never what
was reported as broken.) Clears any pending rotation so a stale queued
rotate/tilt doesn't immediately start playing out from the new spot.
-}
jumpTo : Orientation -> Model -> Model
jumpTo orientation model =
    { model
        | forward = orientation.forward
        , up = orientation.up
        , pendingAzimuth = Angle.degrees 0
        , pendingTilt = Angle.degrees 0
    }


{-| Add `step` to the pending tilt rotation, clamped so the *eventual*
tilt (current + whatever's already pending + this) stays within bounds —
so stacking clicks near the limit only queues up as much as there's
actually room for.
-}
queueTilt : Angle -> Model -> Model
queueTilt step model =
    let
        projected =
            Quantity.plus (tiltOf model.forward) model.pendingTilt

        newProjected =
            Quantity.clamp minTilt maxTilt (Quantity.plus projected step)

        allowedDelta =
            Quantity.minus projected newProjected
    in
    { model | pendingTilt = Quantity.plus model.pendingTilt allowedDelta }


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SetExaggeration value ->
            ( { model | exaggeration = value, meshes = meshesFor value model.elapsedMs }, Cmd.none )

        SetSouth ->
            ( jumpTo southOrientation model, Cmd.none )

        SetOverhead ->
            ( jumpTo overheadOrientation model, Cmd.none )

        SetCamera1 ->
            ( jumpTo camera1Orientation model, Cmd.none )

        TiltUp ->
            ( queueTilt tiltStep model, Cmd.none )

        TiltDown ->
            ( queueTilt (Quantity.negate tiltStep) model, Cmd.none )

        RotateLeft ->
            ( { model | pendingAzimuth = Quantity.minus azimuthStep model.pendingAzimuth }, Cmd.none )

        RotateRight ->
            ( { model | pendingAzimuth = Quantity.plus model.pendingAzimuth azimuthStep }, Cmd.none )

        Tick _ ->
            let
                advanced =
                    model.elapsedMs + tickIntervalMs

                wrapped =
                    if advanced >= loopDurationMs then
                        advanced - loopDurationMs

                    else
                        advanced
            in
            ( { model | elapsedMs = wrapped, meshes = meshesFor model.exaggeration wrapped }, Cmd.none )

        AnimateCamera deltaMs ->
            let
                maxStepDegrees =
                    cameraAnimationSpeed * deltaMs / 1000

                ( azimuthApplied, azimuthRemaining ) =
                    consumeStep maxStepDegrees model.pendingAzimuth

                forward1 =
                    Direction3d.rotateAround Direction3d.positiveZ azimuthApplied model.forward

                up1 =
                    Direction3d.rotateAround Direction3d.positiveZ azimuthApplied model.up

                ( tiltApplied, tiltRemaining ) =
                    consumeStep maxStepDegrees model.pendingTilt

                rightAxis =
                    rightOf forward1 up1

                tiltRotation =
                    Quantity.negate tiltApplied
            in
            ( { model
                | forward = Direction3d.rotateAround rightAxis tiltRotation forward1
                , up = Direction3d.rotateAround rightAxis tiltRotation up1
                , pendingAzimuth = azimuthRemaining
                , pendingTilt = tiltRemaining
              }
            , Cmd.none
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ Time.every tickIntervalMs Tick
        , Browser.Events.onAnimationFrameDelta AnimateCamera
        ]



-- GEOMETRY


toPoint : Float -> GuanRoute.Point -> Point3d Meters WorldCoordinates
toPoint exaggeration p =
    Point3d.feet p.x p.y (p.z * exaggeration)


toLineSegment : Float -> Segment -> LineSegment3d Meters WorldCoordinates
toLineSegment exaggeration segment =
    LineSegment3d.from (toPoint exaggeration segment.from) (toPoint exaggeration segment.to)


{-| Straight-line ground distance between a segment's endpoints, in feet
(z excluded — matches guan_route.length_meters, which is a 2D path length,
closely enough for animation timing purposes).
-}
segmentLength : Segment -> Float
segmentLength s =
    sqrt ((s.to.x - s.from.x) ^ 2 + (s.to.y - s.from.y) ^ 2)


totalLength : Float
totalLength =
    segments |> List.map segmentLength |> List.sum


{-| A segment plus where it falls in the walk, as a [0, 1] fraction of the
total route length — mirrors route-animation.js's segments.startFraction /
endFraction, computed once here rather than every tick.
-}
type alias TimedSegment =
    { segment : Segment
    , startFraction : Float
    , endFraction : Float
    }


timedSegments : List TimedSegment
timedSegments =
    let
        step segment ( distanceBefore, acc ) =
            let
                distanceAfter =
                    distanceBefore + segmentLength segment
            in
            ( distanceAfter
            , { segment = segment
              , startFraction = distanceBefore / totalLength
              , endFraction = distanceAfter / totalLength
              }
                :: acc
            )
    in
    List.foldl step ( 0, [] ) segments
        |> Tuple.second
        |> List.reverse


{-| Bounding box of the route in feet — computed from the raw, unexaggerated
coordinates so the camera framing doesn't shift as the exaggeration slider
moves (z is folded in separately, scaled by exaggeration, at the point of use).
-}
bounds : { minX : Float, maxX : Float, minY : Float, maxY : Float, minZ : Float, maxZ : Float }
bounds =
    let
        xs =
            List.concatMap (\s -> [ s.from.x, s.to.x ]) segments

        ys =
            List.concatMap (\s -> [ s.from.y, s.to.y ]) segments

        zs =
            List.concatMap (\s -> [ s.from.z, s.to.z ]) segments

        min0 list =
            List.minimum list |> Maybe.withDefault 0

        max0 list =
            List.maximum list |> Maybe.withDefault 0
    in
    { minX = min0 xs, maxX = max0 xs, minY = min0 ys, maxY = max0 ys, minZ = min0 zs, maxZ = max0 zs }


centerX : Float
centerX =
    (bounds.minX + bounds.maxX) / 2


centerY : Float
centerY =
    (bounds.minY + bounds.maxY) / 2


centerZ : Float
centerZ =
    (bounds.minZ + bounds.maxZ) / 2


spreadX : Float
spreadX =
    bounds.maxX - bounds.minX


spreadY : Float
spreadY =
    bounds.maxY - bounds.minY


spreadZ : Float
spreadZ =
    bounds.maxZ - bounds.minZ


{-| A little padding around the route so it doesn't touch the frame edges.
-}
margin : Float
margin =
    1.2


{-| Pixel dimensions of the viewport, matching the route's ground-plan aspect
ratio. Longest side is 900px. Since the camera is now tilted rather than
looking straight down, this is an approximation of the on-screen aspect
ratio, not exact.
-}
viewportDimensions : ( Int, Int )
viewportDimensions =
    let
        longest =
            max spreadX spreadY

        scale =
            900 / longest
    in
    ( round (spreadX * scale), round (spreadY * scale) )


{-| Orbit camera: always looking at the route's (exaggerated) center, at
whatever orientation (forward, up) the model currently holds. Since the
projection is orthographic, eye *distance* doesn't affect the rendered
size of anything — only orientation and fov do — so it's fixed at
whatever keeps the whole route comfortably in front of the camera.

Passing our own tracked `up` (rather than a fixed world reference) into
Camera3d.lookAt means it never hits its own degenerate case either:
forward and up are always exactly perpendicular by construction, so
Camera3d.lookAt's internal forward-vs-up cross product is never zero.
-}
cameraFor : Direction3d WorldCoordinates -> Direction3d WorldCoordinates -> Float -> Camera3d Meters WorldCoordinates
cameraFor forward up exaggeration =
    let
        exaggeratedSpreadZ =
            spreadZ * exaggeration

        exaggeratedCenterZ =
            centerZ * exaggeration

        focalPoint =
            Point3d.feet centerX centerY exaggeratedCenterZ

        distance =
            max spreadX spreadY * 1.5

        eyePoint =
            focalPoint |> Point3d.translateIn (Direction3d.reverse forward) (Length.feet distance)

        fovHeight =
            max spreadX (spreadY + 0 * exaggeratedSpreadZ) * margin
    in
    Camera3d.lookAt
        { eyePoint = eyePoint
        , focalPoint = focalPoint
        , upDirection = up
        , projection = Orthographic
        , fov = Camera3d.height (Length.feet fovHeight)
        }



-- VIEW


presetButtons : Html Msg
presetButtons =
    Html.div [ Attr.class "view-toggle" ]
        [ Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick SetOverhead ] [ Html.text "Overhead" ]
        , Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick SetSouth ] [ Html.text "South" ]
        , Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick SetCamera1 ] [ Html.text "Camera 1" ]
        ]


orbitButtons : Html Msg
orbitButtons =
    Html.div [ Attr.class "view-toggle" ]
        [ Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick TiltUp ] [ Html.text "Angle up" ]
        , Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick TiltDown ] [ Html.text "Angle down" ]
        , Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick RotateLeft ] [ Html.text "Rotate left" ]
        , Html.button [ Attr.type_ "button", Attr.class "view-toggle-btn", Events.onClick RotateRight ] [ Html.text "Rotate right" ]
        ]


{-| Which of the three animation states a timed segment is in, given the
current progress fraction — matches route-animation.js's
is-current / is-walked logic.
-}
type WalkState
    = Unwalked
    | Current
    | Walked


walkState : Float -> TimedSegment -> WalkState
walkState progress t =
    if progress >= t.endFraction then
        Walked

    else if progress >= t.startFraction then
        Current

    else
        Unwalked


{-| The three walk-state meshes, built once per (exaggeration, elapsedMs)
pair and stored in the model — NOT recomputed in `view`. elm-3d-scene's
docs call out `Mesh` construction as expensive and meant to be cached
rather than rebuilt on every call; since camera-only changes (dragging the
orbit buttons) update `forward`/`up` at 60fps but never touch
`exaggeration` or `elapsedMs`, keeping meshes keyed to those two lets
camera animation skip rebuilding ~1200 segments' worth of mesh every frame.
-}
type alias Meshes =
    { unwalked : Mesh.Plain WorldCoordinates
    , current : Mesh.Plain WorldCoordinates
    , walked : Mesh.Plain WorldCoordinates
    }


meshesFor : Float -> Float -> Meshes
meshesFor exaggeration elapsedMs =
    let
        toLine =
            toLineSegment exaggeration

        progress =
            elapsedMs / loopDurationMs

        meshFor state =
            timedSegments
                |> List.filter (\t -> walkState progress t == state)
                |> List.map (toLine << .segment)
                |> Mesh.lineSegments
    in
    { unwalked = meshFor Unwalked
    , current = meshFor Current
    , walked = meshFor Walked
    }


view : Model -> Html Msg
view model =
    let
        ( width, height ) =
            viewportDimensions

        entities =
            [ Scene3d.mesh (Material.color (Color.rgb255 0 0 0)) model.meshes.unwalked
            , Scene3d.mesh (Material.color (Color.rgb255 255 0 0)) model.meshes.current
            , Scene3d.mesh (Material.color (Color.rgb255 255 255 255)) model.meshes.walked
            ]
    in
    Html.div [ Attr.class "route-3d" ]
        [ presetButtons
        , orbitButtons
        , Scene3d.unlit
            { camera = cameraFor model.forward model.up model.exaggeration
            , clipDepth = Length.feet 1
            , dimensions = ( Pixels.int width, Pixels.int height )
            , background = Scene3d.transparentBackground
            , entities = entities
            }
        , Html.div [ Attr.class "route-3d-controls" ]
            [ Html.label []
                [ Html.text ("Elevation exaggeration: " ++ String.fromFloat model.exaggeration ++ "×")
                ]
            , Html.input
                [ Attr.type_ "range"
                , Attr.min "1"
                , Attr.max "10"
                , Attr.step "0.5"
                , Attr.value (String.fromFloat model.exaggeration)
                , Events.onInput
                    (\raw ->
                        SetExaggeration (String.toFloat raw |> Maybe.withDefault model.exaggeration)
                    )
                ]
                []
            ]
        ]



-- MAIN


main : Program () Model Msg
main =
    Browser.element
        { init = \_ -> ( init, Cmd.none )
        , update = update
        , view = view
        , subscriptions = subscriptions
        }
