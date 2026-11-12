package ai.moment.pleos

import kotlin.math.roundToInt

/**
 * Shared, Android-independent rules for the MOMENT WebView event contract.
 * Do not manufacture missing data, silently convert unknown units, or turn
 * a request callback into a confirmed vehicle state.
 */
object BridgeContract {
    const val EVENT_SCHEMA = "moment.pleos.bridge.v1"
    const val COMMAND_SCHEMA = "moment.pleos.command.v1"

    /** A percentage is known only if the SDK value is a finite number in [0, 100]. */
    fun batteryPercentage(value: Any?): Int? {
        val number = (value as? Number)?.toDouble() ?: return null
        if (!number.isFinite() || number < 0.0 || number > 100.0) return null
        return number.roundToInt()
    }

    /** Only time values with a VERIFIED unit may enter remainingMinutes. */
    fun minutesFromVerifiedSeconds(seconds: Long?, verifiedUnit: Boolean): Long? {
        if (!verifiedUnit || seconds == null || seconds < 0 || seconds > 172_800) return null
        return (seconds + 59) / 60
    }

    /** Avoid UI injection or unbounded native-to-web messages. */
    fun displayName(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }?.take(88)

    fun shouldAcceptCommand(schema: String?, command: String?, isMainFrame: Boolean): Boolean =
        isMainFrame && schema == COMMAND_SCHEMA && command in setOf("ready", "refreshState")
}