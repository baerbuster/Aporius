import LaurelWreath from '../icons/LaurelWreath'
import HistoryScroll from '../icons/HistoryScroll'

export default function MainScreenView({
  statue,
  isListening,
  isSpinning,
  errorMsg,
  showTapToReturn,
  onOpenHistory,
  onOpenSettings,
  onSpeak,
  onListen,
  onDismissError,
}) {
  return (
    <div className="main-screen">
      <img src="/background.jpg" alt="" className="main-screen__bg" draggable={false} />
      <img src={statue} alt="" className="main-screen__statue" draggable={false} />

      <div className="main-screen__topbar">
        <button className="main-screen__icon-btn" onClick={onOpenHistory} aria-label="Conversation History">
          <HistoryScroll size={51} />
        </button>
        <button className="main-screen__icon-btn" onClick={onOpenSettings} aria-label="Settings">
          <LaurelWreath spinning={isSpinning} size={46} />
        </button>
      </div>

      {errorMsg && (
        <div
          className="main-screen__error-overlay"
          onClick={onDismissError}
        >
          {errorMsg}
          {showTapToReturn && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>Tap to return</div>
          )}
        </div>
      )}

      <div className="main-screen__bottom">
        {isListening ? (
          <button className="main-screen__action-btn" onClick={onSpeak}>
            SPEAK, APORIUS!
          </button>
        ) : (
          <button className="main-screen__action-btn" onClick={onListen}>
            LISTEN, APORIUS!
          </button>
        )}
      </div>
    </div>
  )
}
