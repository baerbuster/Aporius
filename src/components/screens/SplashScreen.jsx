import { useEffect } from 'react'

export default function SplashScreen({ onTap, onBack }) {
  // Handle hardware/browser back button → Ponder This
  useEffect(() => {
    // Push a state so we can catch the back navigation
    window.history.pushState({ screen: 'splash' }, '')

    const handlePopState = () => {
      onBack()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [onBack])

  return (
    <div className="screen splash" onClick={onTap} role="button" tabIndex={0}>
      <div className="splash__title-row">
        <div className="divider" />
        <h1 className="splash__title">Aporius.</h1>
        <div className="divider" />
      </div>

      <p className="splash__quote">
        The unexamined life is not worth living...
      </p>
    </div>
  )
}
