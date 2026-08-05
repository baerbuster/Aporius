import { useState } from 'react'
import SplashScreen from './components/screens/SplashScreen'
import KnowThyself from './components/screens/KnowThyself'
import MainScreen from './components/screens/MainScreen'
import ConversationHistory from './components/screens/ConversationHistory'
import PonderThis from './components/screens/PonderThis'

const SETTINGS_KEY = 'aporius_settings'

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch {
    return {}
  }
}

// Deepgram is in here because the murmur side runs on it: MainScreen feeds this
// key straight to createLiveSentenceStream, which is what the reflection stream
// consumes. Leave it out of the gate and a fresh device gets waved through to a
// main screen whose entire reflection half is silently dead.
function hasAllKeys(s) {
  return !!(
    s.groqKey &&
    s.claudeKey &&
    s.elevenLabsKey &&
    s.googleTTSKey &&
    s.deepgramKey
  )
}

export default function App() {
  const [screen, setScreen] = useState('splash')
  const [prevScreen, setPrevScreen] = useState('splash')
  const [settings, setSettings] = useState(loadSettings)

  const navigate = (to) => {
    setPrevScreen(screen)
    setScreen(to)
  }

  const handleSplashTap = () => {
    const s = loadSettings()
    setSettings(s)
    if (!hasAllKeys(s)) {
      navigate('settings')
    } else {
      navigate('main')
    }
  }

  const handleSettingsSave = (newSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings))
    setSettings(newSettings)
    navigate('main')
  }

  const handleBackFromSettings = () => {
    navigate(prevScreen === 'main' ? 'main' : 'splash')
  }

  return (
    <div className="app">
      {screen === 'splash' && (
        <SplashScreen
          onTap={handleSplashTap}
          onBack={() => navigate('ponder')}
        />
      )}

      {screen === 'settings' && (
        <KnowThyself
          settings={settings}
          onSave={handleSettingsSave}
          onBack={handleBackFromSettings}
        />
      )}

      {/* Main screen is kept mounted while navigating to history/settings
          so mic state survives — but we unmount on settings/history deliberately
          to keep things simple for MVP. Re-entering main re-inits the mic. */}
      {screen === 'main' && (
        <MainScreen
          key="main"
          settings={settings}
          onOpenHistory={() => navigate('history')}
          onOpenSettings={() => navigate('settings')}
        />
      )}

      {screen === 'history' && (
        <ConversationHistory onBack={() => navigate('main')} />
      )}

      {screen === 'ponder' && (
        <PonderThis onBack={() => navigate('splash')} />
      )}
    </div>
  )
}
