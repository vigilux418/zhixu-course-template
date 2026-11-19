/* 阶梯的几何：分几段、每段几级、每级多高、哪一级是平台。纯计算，不碰页面，可以直接在 Node 里测试。 */

const FLIGHT_MAX = 16; // 一段阶梯最多这么多级；讲数再多，就平分成几段，一段排一行
const FLIGHT_RISE = 88; // 一段阶梯一共升这么高（像素）：每一级的高度由它平分，取整
const RISE_RANGE = [4, 24]; // 每一级最矮、最高是多少

/**
 * units 是每一讲所属的单元（按讲次的先后）。返回：
 *   flights 分几段；size 每段几级（最后一段可能少几级）；rise 每一级升多高（像素）；
 *   steps 每一讲的 { level: 它是这一段里的第几级（从 0 数）, landing: 是不是平台 }。
 * 平台是一个单元的最后一级；一段的最后一级后面没有台阶了，不算平台。
 */
export function stairPlan(units) {
  const flights = Math.ceil(units.length / FLIGHT_MAX);
  const size = Math.ceil(units.length / flights);
  const [lowest, highest] = RISE_RANGE;
  return {
    flights,
    size,
    rise: Math.max(lowest, Math.min(highest, Math.floor(FLIGHT_RISE / size))),
    steps: units.map((unit, index) => {
      const level = index % size;
      const last = level === size - 1 || index === units.length - 1;
      return { level, landing: !last && units[index + 1] !== unit };
    })
  };
}
