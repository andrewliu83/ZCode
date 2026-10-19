# @zcode/zcode-cua

Cua Driver 0.36.0 adapter for the existing ZCode Computer Use SDK. The macOS arm64
build stages the verified CuaDriver.app and native SDK outside ASAR. The app owns
Accessibility and Screen Recording grants; the window Host owns its lifecycle and
connection generation, while the runtime owns session state, element tokens and
capture frames.

The schema-2 `zcodeCuaRuntime.driver` manifest selects this distribution. The legacy
`zcodeCuaPlaceholder` flag keeps the removed Helper build pipeline disabled. Legacy
PiP and native-addon compatibility APIs remain unavailable; unsupported action
semantics return explicit errors. See SPEC.md for ownership and supported boundaries.

License: Apache-2.0.
