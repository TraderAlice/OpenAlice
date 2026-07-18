/* This boot reader deliberately contains no palette or token mapping. The typed
 * projection authority writes the exact resolved CSS-variable projection. */
(function () {
  var key = 'openalice.theme.first-paint.v1'
  var expectedProjectionShapeFingerprint = 'fnv1a32-ba62d433'
  function fingerprint(serialized) {
    var hash = 0x811c9dc5
    for (var index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return 'fnv1a32-' + (hash >>> 0).toString(16).padStart(8, '0')
  }
  function evict(reason) {
    console.warn('[theme:first-paint] Evicted stale cache: ' + reason)
    try {
      localStorage.removeItem(key)
    } catch (removeError) {
      console.warn('[theme:first-paint] Cache eviction unavailable: ' +
        (removeError && typeof removeError.message === 'string' ? removeError.message : 'storage unavailable'))
    }
  }
  try {
    var raw = localStorage.getItem(key)
    if (!raw) return
    var cache = JSON.parse(raw)
    if (cache.schemaVersion !== 1 || cache.mappingVersion !== 1) return evict('version mismatch')
    if (!['system', 'light', 'dark'].includes(cache.appearanceMode) ||
        !['light', 'dark'].includes(cache.resolvedMode) ||
        typeof cache.familyId !== 'string' || typeof cache.variantId !== 'string' ||
        typeof cache.tokenFingerprint !== 'string' ||
        cache.projectionShapeFingerprint !== expectedProjectionShapeFingerprint || !cache.variables ||
        Object.getPrototypeOf(cache.variables) !== Object.prototype) return evict('invalid shape')
    var actualShapeFingerprint = fingerprint(Object.keys(cache.variables).sort().join(';'))
    if (actualShapeFingerprint !== expectedProjectionShapeFingerprint) return evict('incomplete projection')
    for (var name in cache.variables) {
      var value = cache.variables[name]
      if (!/^(?:--oa-(?:token|runtime)-.+|--color-.+|--app-bg-wash)$/.test(name) || typeof value !== 'string' ||
          value.length > 256 || /[;}]/.test(value)) return evict('invalid projection')
    }
    var serialized = Object.keys(cache.variables).sort().map(function (name) {
      return name + ':' + cache.variables[name]
    }).join(';')
    if (fingerprint(serialized) !== cache.tokenFingerprint) return evict('token fingerprint mismatch')
    var osMode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    if (cache.appearanceMode === 'system' && cache.resolvedMode !== osMode) {
      return evict('system appearance changed while the app was stopped')
    }
    for (var cssName in cache.variables) {
      document.documentElement.style.setProperty(cssName, cache.variables[cssName])
    }
    document.documentElement.dataset.theme = cache.resolvedMode
    document.documentElement.dataset.themeAppearance = cache.appearanceMode
    document.documentElement.dataset.themeFamily = cache.familyId
    document.documentElement.dataset.themeVariant = cache.variantId
    document.documentElement.dataset.themeFingerprint = cache.tokenFingerprint
    document.documentElement.dataset.themeFirstPaint = 'cache'
    document.documentElement.style.colorScheme = cache.resolvedMode
  } catch (error) {
    evict(error && typeof error.message === 'string' ? error.message : 'unreadable cache')
  }
})()
