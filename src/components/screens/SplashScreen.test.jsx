import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SplashScreen from './SplashScreen'
import PonderThis from './PonderThis'

describe('SplashScreen', () => {
  const setup = () => {
    const onTap = vi.fn()
    const onBack = vi.fn()
    render(<SplashScreen onTap={onTap} onBack={onBack} />)
    return { onTap, onBack }
  }

  it('shows the name and the epigraph', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Aporius.' })).toBeInTheDocument()
    expect(screen.getByText(/The unexamined life is not worth living/)).toBeInTheDocument()
  })

  it('enters on a tap anywhere', () => {
    const { onTap } = setup()
    fireEvent.click(screen.getByRole('button'))
    expect(onTap).toHaveBeenCalled()
  })

  it('pushes a history entry so there is a back navigation to catch', () => {
    // Without this there is nothing on the stack, and the hardware back button
    // leaves the app instead of reaching the riddle.
    const pushState = vi.spyOn(window.history, 'pushState')
    setup()
    expect(pushState).toHaveBeenCalledWith({ screen: 'splash' }, '')
  })

  it('goes to the riddle on the hardware back button', () => {
    const { onBack } = setup()
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(onBack).toHaveBeenCalled()
  })

  it('stops listening once it is gone', () => {
    // The listener is on `window`, which outlives the component — leaving it
    // attached would fire onBack from a screen the user has already left.
    const onBack = vi.fn()
    const { unmount } = render(<SplashScreen onTap={() => {}} onBack={onBack} />)

    unmount()
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })

    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('PonderThis', () => {
  it('poses the riddle', () => {
    render(<PonderThis onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Ponder This...' })).toBeInTheDocument()
    expect(
      screen.getByText('How can a man go back to a place he has never been?'),
    ).toBeInTheDocument()
  })

  it('goes back', () => {
    const onBack = vi.fn()
    render(<PonderThis onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})
