export default function PonderThis({ onBack }) {
  return (
    <div className="screen">
      <div className="ponder__header">
        <button className="screen__back" onClick={onBack} aria-label="Back">
          ←
        </button>
      </div>

      <div className="ponder__title-row">
        <div className="divider" />
        <h1 className="ponder__title">Ponder This...</h1>
        <div className="divider" />
      </div>

      <div className="ponder__body">
        <p className="ponder__riddle">
          How can a man go back to a place he has never been?
        </p>
      </div>
    </div>
  )
}
