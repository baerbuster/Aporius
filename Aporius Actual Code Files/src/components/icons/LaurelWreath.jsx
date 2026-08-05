// Gold laurel wreath — two quarter-circle bezier segments per branch for a true circular shape.

function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t
  return [
    u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1],
  ]
}

function bezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t
  return [
    3*u*u*(p1[0]-p0[0]) + 6*u*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0]),
    3*u*u*(p1[1]-p0[1]) + 6*u*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1]),
  ]
}

function generateBranch(p0, p1, p2, p3, side, leafCount, prefix) {
  const leaves = []
  for (let i = 0; i < leafCount; i++) {
    const t = (i + 0.5) / leafCount
    const [cx, cy] = bezierPoint(p0, p1, p2, p3, t)
    const [tx, ty] = bezierTangent(p0, p1, p2, p3, t)
    const len = Math.sqrt(tx*tx + ty*ty) || 1

    const nx = side === 'left' ? ty/len : -ty/len
    const ny = side === 'left' ? -tx/len : tx/len
    const tangentAngleDeg = (Math.atan2(ty, tx) * 180) / Math.PI

    const lx1 = cx + nx*10
    const ly1 = cy + ny*10
    const rot1 = tangentAngleDeg + (side === 'left' ? -90 : 90)

    const fwdAngle = tangentAngleDeg + (side === 'left' ? -55 : 55)
    const fwdRad = (fwdAngle * Math.PI) / 180
    const lx2 = cx + Math.cos(fwdRad)*9
    const ly2 = cy + Math.sin(fwdRad)*9

    const bwdAngle = tangentAngleDeg + (side === 'left' ? -125 : 125)
    const bwdRad = (bwdAngle * Math.PI) / 180
    const lx3 = cx + Math.cos(bwdRad)*9
    const ly3 = cy + Math.sin(bwdRad)*9

    leaves.push(
      <ellipse key={`${prefix}-a-${i}`} cx={lx1} cy={ly1} rx={3.2} ry={5.5} fill="#FFD900" transform={`rotate(${rot1},${lx1},${ly1})`} />,
      <ellipse key={`${prefix}-b-${i}`} cx={lx2} cy={ly2} rx={2.8} ry={4.8} fill="#FFD900" transform={`rotate(${fwdAngle+90},${lx2},${ly2})`} />,
      <ellipse key={`${prefix}-c-${i}`} cx={lx3} cy={ly3} rx={2.8} ry={4.8} fill="#FFD900" transform={`rotate(${bwdAngle+90},${lx3},${ly3})`} />,
    )
  }
  return leaves
}

export default function LaurelWreath({ spinning = false, size = 46 }) {
  // Circle: center (50,50), radius 32 — open at the bottom like a crown
  // Branches start at ~225° and ~315° (bottom-sides), arch over the top

  // Left branch:  (27,73) → (18,50) → (50,18)
  const LL = { p0:[27,73], p1:[19,73], p2:[18,61], p3:[18,50] } // lower-left arc
  const LT = { p0:[18,50], p1:[18,32], p2:[32,18], p3:[50,18] } // upper-left quarter

  // Right branch: (73,73) → (82,50) → (50,18)
  const RL = { p0:[73,73], p1:[81,73], p2:[82,61], p3:[82,50] } // lower-right arc
  const RT = { p0:[82,50], p1:[82,32], p2:[68,18], p3:[50,18] } // upper-right quarter

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={spinning ? 'spinning' : undefined}
      style={spinning ? { transformOrigin: '50% 50%' } : undefined}
    >
      {/* Left stem */}
      <path d="M 27,73 C 19,73 18,61 18,50 C 18,32 32,18 50,18"
        stroke="#FFD900" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Right stem */}
      <path d="M 73,73 C 81,73 82,61 82,50 C 82,32 68,18 50,18"
        stroke="#FFD900" strokeWidth="3" fill="none" strokeLinecap="round" />
      {generateBranch(LL.p0, LL.p1, LL.p2, LL.p3, 'left',  2, 'll')}
      {generateBranch(LT.p0, LT.p1, LT.p2, LT.p3, 'left',  4, 'lt')}
      {generateBranch(RL.p0, RL.p1, RL.p2, RL.p3, 'right', 2, 'rl')}
      {generateBranch(RT.p0, RT.p1, RT.p2, RT.p3, 'right', 4, 'rt')}
    </svg>
  )
}
