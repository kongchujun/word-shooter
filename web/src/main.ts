import './style.css'
import { Engine } from './core/Engine'
import { Game } from './core/Game'
import { MathApp } from './math/MathApp'
import { MathScreen } from './math/MathScreen'
import { gameByView } from './math/questions'
import { Shell } from './shell/Shell'
import { WhackApp } from './whack/WhackApp'
import { whackGameByView } from './whack/sets'
import { ArenaApp } from './arena/ArenaApp'
import { applyDocumentLang } from './i18n'

applyDocumentLang()

const canvas = document.getElementById('game') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLDivElement
const ctx = canvas.getContext('2d')

if (!ctx) throw new Error('浏览器不支持 Canvas 2D')

const engine = new Engine(canvas, ctx)
const shell = new Shell(ui)
const game = new Game(engine, ui)
const mathHome = new MathScreen(ui)
const mathApp = new MathApp(engine, ui)
const whackApp = new WhackApp(engine, ui)
const arenaApp = new ArenaApp(engine, ui)

game.onPlaying = (playing) => shell.setBarVisible(!playing)
mathApp.onPlaying = (playing) => shell.setBarVisible(!playing)
whackApp.onPlaying = (playing) => shell.setBarVisible(!playing)
arenaApp.onPlaying = (playing) => shell.setBarVisible(!playing)
mathHome.onPick = (view) => shell.go(view)
whackApp.onPick = (view) => shell.go(view)

shell.onNavigate = (view) => {
  const quiz = gameByView(view)
  const whack = whackGameByView(view)

  if (view !== 'words') game.leave()
  if (view !== 'math') mathHome.hide()
  if (!whack && view !== 'whack') whackApp.leave()
  if (view !== 'arena') arenaApp.leave()
  shell.setBarVisible(true)

  // 先等多人房 leave 完成,再进新页,避免幽灵座位还占着
  void (async () => {
    await mathApp.leave()
    if (view === 'words') void game.enter()
    if (view === 'math') mathHome.show()
    if (quiz) mathApp.enter(quiz)
    if (view === 'whack') whackApp.enterHome()
    if (whack) whackApp.enter(whack)
    if (view === 'arena') arenaApp.enter()
  })()
}

shell.start()
