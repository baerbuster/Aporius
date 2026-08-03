import { useRef, useCallback } from 'react'
import { transcribeAudio } from '../services/groq'

function encodeWAV(chunks) {
  const totalBytes = chunks.reduce((sum, buf) => sum + buf.byteLength, 0)
  const buffer = new ArrayBuffer(44 + totalBytes)
  const view = new DataView(buffer)
  const sampleRate = 16000
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + totalBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, totalBytes, true)

  let offset = 44
  for (const chunk of chunks) {
    new Uint8Array(buffer).set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export function useAudioCapture({ groqKey, onAudioChunk }) {
  const audioContextRef = useRef(null)
  const workletNodeRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const streamRef = useRef(null)
  const localBufferRef = useRef([])

  // Kept in a ref so the worklet handler always sees the current consumer
  // without re-running startCapture.
  const onAudioChunkRef = useRef(onAudioChunk)
  onAudioChunkRef.current = onAudioChunk

  const startCapture = useCallback(async () => {
    localBufferRef.current = []

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    streamRef.current = micStream

    let audioContext
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
        latencyHint: 'interactive',
      })
    } catch {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
      })
    }
    audioContextRef.current = audioContext

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    await audioContext.audioWorklet.addModule('/audio-processor.js')

    const workletNode = new AudioWorkletNode(audioContext, 'audio-processor', {
      processorOptions: {
        sourceSampleRate: audioContext.sampleRate,
        targetSampleRate: 16000,
      },
      numberOfInputs: 1,
      numberOfOutputs: 0,
    })
    workletNodeRef.current = workletNode

    workletNode.port.onmessage = (event) => {
      localBufferRef.current.push(event.data)
      // Same PCM fans out to the live (murmur-side) transcript. Must never
      // interfere with the Groq batch path above.
      try {
        onAudioChunkRef.current?.(event.data)
      } catch (err) {
        console.warn('[Capture] audio chunk consumer threw:', err)
      }
    }

    const source = audioContext.createMediaStreamSource(micStream)
    sourceNodeRef.current = source
    source.connect(workletNode)
  }, [])

  const stopCaptureAndGetTranscript = useCallback(async () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null
      try { workletNodeRef.current.disconnect() } catch { /* ignore */ }
      workletNodeRef.current = null
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect() } catch { /* ignore */ }
      sourceNodeRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    const chunks = localBufferRef.current
    localBufferRef.current = []

    if (!chunks.length) return ''

    const wavBlob = encodeWAV(chunks)
    return await transcribeAudio({ apiKey: groqKey, audioBlob: wavBlob })
  }, [groqKey])

  const cleanup = useCallback(async () => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null
      try { workletNodeRef.current.disconnect() } catch { /* ignore */ }
      workletNodeRef.current = null
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect() } catch { /* ignore */ }
      sourceNodeRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    localBufferRef.current = []
  }, [])

  return { startCapture, stopCaptureAndGetTranscript, cleanup }
}
