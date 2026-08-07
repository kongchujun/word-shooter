import './style.css'
import { Engine } from './core/Engine'
import { Game } from './core/Game'
import { MathApp } from './math/MathApp'
import { MathScreen } from './math/MathScreen'
import { gameByView } from './math/questions'
import { Shell } from './shell/Shell'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLDivElement
const ctx = canvas.getContext('2d')

if (!ctx) throw new Error('浏览器不支持 Canvas 2D')

const engine = new Engine(canvas, ctx)
const shell = new Shell(ui)
const game = new Game(engine, ui)
const mathHome = new MathScreen(ui)
const mathApp = new MathApp(engine, ui)

game.onPlaying = (playing) => shell.setBarVisible(!playing)
mathApp.onPlaying = (playing) => shell.setBarVisible(!playing)
mathHome.onPick = (view) => shell.go(view)

shell.onNavigate = (view) => {
  const quiz = gameByView(view)

  if (view !== 'words') game.leave()
  if (view !== 'math') mathHome.hide()
  if (!quiz) mathApp.leave()
  shell.setBarVisible(true)

  if (view === 'words') void game.enter()
  if (view === 'math') mathHome.show()
  if (quiz) mathApp.enter(quiz)
}

shell.start()
