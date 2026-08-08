import { t } from '../../i18n'
import { BIKE_DURATION, type BikeLevel } from '../bike/levels'
import { nextFourOps } from '../bike/questions'

/** 双人固定一档:100 以内四则,30 秒。进页就是开房间,不再选难度。 */
export function bikeDuelLevel(): BikeLevel {
  return {
    id: 'math.bikeDuel',
    name: t('math.game.bikeDuel'),
    icon: '🏁',
    desc: t('math.desc.bike.100'),
    rounds: BIKE_DURATION,
    max: 100,
    duration: BIKE_DURATION,
    next: () => nextFourOps(100),
  }
}

/** 给 GAMES() 占位;双人玩法不走选关列表 */
export function BIKE_DUEL_LEVELS(): BikeLevel[] {
  return [bikeDuelLevel()]
}
