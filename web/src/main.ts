import './style.css'
import { Game } from './core/Game'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ui = document.getElementById('ui') as HTMLDivElement
const ctx = canvas.getContext('2d')

if (!ctx) throw new Error('浏览器不支持 Canvas 2D')

void new Game(canvas, ctx, ui).start()
