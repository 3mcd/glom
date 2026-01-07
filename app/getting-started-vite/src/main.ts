import {
  type Add,
  type All,
  type Despawn,
  type Entity,
  type In,
  type Join,
  type Out,
  type Spawn,
  type Unique,
  type Write,
  addSystem,
  advanceTimestep,
  defineComponent,
  defineRelation,
  defineTag,
  flushGraphChanges,
  makeSystemSchedule,
  makeTimestep,
  makeWorld,
  runSchedule,
  spawn,
} from "@glom/ecs"

// 2. Defining Components
const Pos = defineComponent<{x: number; y: number}>()
const Vel = defineComponent<{dx: number; dy: number}>()
const Sfx = defineComponent<{clip: string}>()

const Player = defineTag()
const Item = defineTag()
const Collected = defineTag()
const SfxManager = defineTag()

const PlaysOn = defineRelation()

// 3. Writing Systems

const input = {
  up: false,
  down: false,
  left: false,
  right: false,
}

const keyMap: Record<string, keyof typeof input> = {
  ArrowUp: "up",
  w: "up",
  ArrowDown: "down",
  s: "down",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
}

window.addEventListener("keydown", (e) => {
  if (e.key in keyMap) input[keyMap[e.key]] = true
})

window.addEventListener("keyup", (e) => {
  if (e.key in keyMap) input[keyMap[e.key]] = false
})

// Moving Players
const movePlayers = (
  query: All<Write<typeof Pos>, Write<typeof Vel>, typeof Player>,
) => {
  for (const [pos, vel] of query) {
    const speed = 4
    vel.dx = 0
    vel.dy = 0

    if (input.up) vel.dy = -speed
    if (input.down) vel.dy = speed
    if (input.left) vel.dx = -speed
    if (input.right) vel.dx = speed

    pos.x += vel.dx
    pos.y += vel.dy

    // Keep on screen for this demo
    pos.x = Math.max(10, Math.min(590, pos.x))
    pos.y = Math.max(10, Math.min(390, pos.y))
  }
}

// Collecting Items
type CollectQuery = Join<
  All<typeof Pos, typeof Player>,
  All<Entity, typeof Pos, typeof Item>
>

const collectItems = (query: CollectQuery, collect: Add<typeof Collected>) => {
  for (const [pPos, , item, iPos] of query) {
    const dist = Math.hypot(pPos.x - iPos.x, pPos.y - iPos.y)
    if (dist < 20) {
      collect(item)
    }
  }
}

// Reactive Systems
const despawnCollected = (
  items: In<Entity, typeof Collected>,
  despawn: Despawn,
) => {
  for (const [entity] of items) {
    despawn(entity)
  }
}

const playPickupSfx = (
  removedItems: Out<Entity, typeof Item>,
  spawnSfx: Spawn<typeof Sfx>,
  play: Add<typeof PlaysOn>,
  [manager]: Unique<Entity, typeof SfxManager>,
) => {
  for (const [entity] of removedItems) {
    const sfx = spawnSfx(Sfx({clip: "pickup.wav"}))
    play(sfx, PlaysOn, manager)

    const log = document.getElementById("log")
    if (log) {
      log.innerText = `Picked up item ${entity}! Playing sfx: pickup.wav`
      log.style.color = "#ffff00"
      setTimeout(() => {
        log.style.color = "#eee"
      }, 500)
    }
  }
}

const processSfx = (
  query: Join<All<Entity, typeof Sfx>, All<typeof SfxManager>, typeof PlaysOn>,
  despawn: Despawn,
) => {
  for (const [entity, sfx] of query) {
    console.log("playing sound", sfx.clip)
    despawn(entity)
  }
}

// Added rendering system for visualization
const canvas = document.getElementById("game") as HTMLCanvasElement
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D

const render = (
  players: All<typeof Pos, typeof Player>,
  items: All<typeof Pos, typeof Item>,
  collected: All<typeof Pos, typeof Collected>,
) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Draw Players (Blue)
  ctx.fillStyle = "#00aaff"
  for (const [pos] of players) {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw Items (Red)
  ctx.fillStyle = "#ff4444"
  for (const [pos] of items) {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw Collected (Yellow)
  ctx.fillStyle = "#ffff00"
  for (const [pos] of collected) {
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2)
    ctx.stroke()
  }
}

// 4. Scheduling and Running
const world = makeWorld()
const schedule = makeSystemSchedule()

addSystem(schedule, movePlayers)
addSystem(schedule, collectItems)
addSystem(schedule, despawnCollected)
addSystem(schedule, playPickupSfx)
addSystem(schedule, processSfx)
addSystem(schedule, render)

// Initialize our world
spawn(world, SfxManager)

// spawn a player
spawn(world, Player, Pos({x: 50, y: 50}), Vel({dx: 2, dy: 1.5}))

// spawn some items
for (let i = 0; i < 15; i++) {
  spawn(
    world,
    Item,
    Pos({
      x: Math.random() * 500 + 50,
      y: Math.random() * 300 + 50,
    }),
  )
}

flushGraphChanges(world)

// 5. The Main Loop (Fixed Timestep)
const timestep = makeTimestep(60)

function loop() {
  const now = performance.now()

  advanceTimestep(timestep, now, () => {
    runSchedule(schedule, world)
  })

  requestAnimationFrame(loop)
}

loop()
