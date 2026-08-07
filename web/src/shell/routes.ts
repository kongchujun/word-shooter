/**
 * 侧栏里的几个去处。hash 里存的就是这个 id。
 * 单独放一个文件:侧栏和各个游戏都要引它,放 Shell.ts 里会绕成循环依赖。
 */
export type ViewId = 'home' | 'words' | 'math' | 'math/mult' | 'math/addsub' | 'math/balance'
