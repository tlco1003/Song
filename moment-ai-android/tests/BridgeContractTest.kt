import ai.moment.pleos.BridgeContract

fun main() {
    fun checkEqual(expected: Any?, actual: Any?) = check(expected == actual) { "Expected $expected, got $actual" }
    checkEqual(78, BridgeContract.batteryPercentage(78.3))
    checkEqual(0, BridgeContract.batteryPercentage(0))
    checkEqual(100, BridgeContract.batteryPercentage(100.0))
    checkEqual(null, BridgeContract.batteryPercentage(-1))
    checkEqual(null, BridgeContract.batteryPercentage(101))
    checkEqual(null, BridgeContract.batteryPercentage(Double.NaN))
    checkEqual(null, BridgeContract.batteryPercentage("78"))
    checkEqual(null, BridgeContract.minutesFromVerifiedSeconds(7200, false))
    checkEqual(120L, BridgeContract.minutesFromVerifiedSeconds(7200, true))
    checkEqual(null, BridgeContract.minutesFromVerifiedSeconds(-1, true))
    checkEqual(null, BridgeContract.minutesFromVerifiedSeconds(172801, true))
    checkEqual(null, BridgeContract.displayName("  "))
    checkEqual("부산", BridgeContract.displayName("  부산  "))
    check(BridgeContract.shouldAcceptCommand(BridgeContract.COMMAND_SCHEMA, "ready", true))
    check(BridgeContract.shouldAcceptCommand(BridgeContract.COMMAND_SCHEMA, "refreshState", true))
    check(!BridgeContract.shouldAcceptCommand(BridgeContract.COMMAND_SCHEMA, "refreshState", false))
    check(!BridgeContract.shouldAcceptCommand("wrong.schema", "ready", true))
    check(!BridgeContract.shouldAcceptCommand(BridgeContract.COMMAND_SCHEMA, "setWaypoint", true))
    println("BridgeContract checks passed: 18 assertions")
}