// History Scroll button icon — matches reference design.
// Brown handles poke out above & below yellow bracket caps.
// Paper body sits between the caps. 5x5 symbol grid.

const SYMBOLS = ['□','○','△','★','□','○','△','★','□','△','○','□','△','★','○','□','○','△','□','★','★','□','○','△','○']

export default function HistoryScroll({ size = 56 }) {
  const vw = 110
  const vh = 100

  // Handle dimensions
  const hx = 3          // left handle x
  const hw = 14         // handle width
  // Handle runs the full height — sticks out above and below caps
  const hFull = vh      // y=0 to y=100

  // Yellow bracket caps
  const capW = hw + 4   // slightly wider than handle
  const capH = 14
  const capX = hx - 2
  const capY_top = 8    // top cap pushed outward
  const capY_bot = 78   // bot cap pushed outward

  // Paper sits between the inner edges of the caps
  const paperX = hx + hw + 2
  const paperY = capY_top + capH     // 22
  const paperW = vw - (hx + hw + 2) * 2
  const paperH = capY_bot - paperY   // 56

  const rhx = vw - hx - hw  // right handle x

  // Symbol grid
  const cols = 5
  const rows = 4
  const cellW = paperW / cols
  const cellH = paperH / rows
  const symbols = []
  let idx = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = paperX + col * cellW + cellW / 2
      const y = paperY + row * cellH + cellH / 2 + 3
      symbols.push(
        <text key={idx} x={x} y={y} textAnchor="middle" fontSize="9" fill="#000000" fontFamily="serif">
          {SYMBOLS[idx % SYMBOLS.length]}
        </text>
      )
      idx++
    }
  }

  return (
    <svg width={(size * vh) / vw} height={size} viewBox={`0 0 ${vw} ${vh}`} style={{ transform: 'rotate(90deg)' }}>

      {/* Left handle — full height, sticks out above & below caps */}
      <rect x={hx} y={0} width={hw} height={hFull} rx={4} fill="#5B4E3F" />
      {/* Right handle */}
      <rect x={rhx} y={0} width={hw} height={hFull} rx={4} fill="#5B4E3F" />

      {/* Paper body */}
      <rect x={paperX} y={paperY} width={paperW} height={paperH} fill="#F5CCA3" />

      {/* Left caps (drawn over handle) */}
      <rect x={capX} y={capY_top} width={capW} height={capH} rx={2} fill="#FFD900" />
      <rect x={capX} y={capY_bot} width={capW} height={capH} rx={2} fill="#FFD900" />

      {/* Right caps */}
      <rect x={rhx - 2} y={capY_top} width={capW} height={capH} rx={2} fill="#FFD900" />
      <rect x={rhx - 2} y={capY_bot} width={capW} height={capH} rx={2} fill="#FFD900" />

      {/* Symbols */}
      {symbols}
    </svg>
  )
}
