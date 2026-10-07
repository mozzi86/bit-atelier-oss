"""Voice: local speech-to-text (faster-whisper) and optional text-to-speech (Piper).

Everything here imports the heavy libraries lazily. The core service starts
without the `[voice]` extra; the routes then answer 501 with the install hint.
"""
