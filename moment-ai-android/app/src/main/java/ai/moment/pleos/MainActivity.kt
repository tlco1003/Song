package ai.moment.pleos

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RouteStateInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.vehicle.Vehicle
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * MOMENT AI proof-of-concept Android Automotive host.
 *
 *  - Owns the *actual* Pleos SDK objects; no sensor data is fabricated in Kotlin.
 *  - Bundles the existing public web UI unchanged via Gradle syncMomentWeb.
 *  - WebMessage transport is origin-restricted and limited to the main frame.
 *  - No mutable navigation API: reading route state is safe even before route
 *    write/POI-provider permissions and vehicle distraction review are granted.
 *  - NOT certified for use while driving. The host must pass Pleos policy review.
 */
class MainActivity : Activity() {
    private companion object {
        const val BUNDLE_ORIGIN = "https://appassets.androidplatform.net"
        const val APP_URL = "$BUNDLE_ORIGIN/assets/moment/index.html?screen=music"
        const val FILE_REQUEST_CODE = 7127
    }

    private val mainThread = Handler(Looper.getMainLooper())
    private lateinit var browser: WebView
    private var webReady = false
    private var bridgeSupported = false
    private var pageLoaded = false
    private var closed = false
    private var vehicleSdk: Vehicle? = null
    private var naviSdk: NaviHelper? = null
    private var naviListenerInstalled = false
    private var vehicleInitialized = false
    private var naviReady = false
    private var vehicleReady = false
    private var batteryPercent: Int? = null
    private var destinationName: String? = null
    private var routingComplete = false
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null
    private val pendingEvents = ArrayDeque<JSONObject>()

    private val navListener = object : NaviHelperEventListener {
        override fun onRoutingCompleted() {
            mainThread.post {
                if (closed) return@post
                routingComplete = true
                sendRoute()
                requestNavSnapshot()
            }
        }

        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            // NaviHelper's reference docs are incomplete on model units. Only the
            // POI display name is read, and ETA is deliberately left unknown.
            val name = publicStringGetter(destinationInfo, "getPoiName")
            mainThread.post {
                if (closed) return@post
                destinationName = BridgeContract.displayName(name)
                sendRoute()
            }
        }

        override fun onRouteStateInfo(routeStateInfo: RouteStateInfo) {
            // A route state callback is proof an event arrived, NOT proof that its
            // remainTime raw field is in seconds or that routing succeeded.
            mainThread.post { if (!closed) sendRoute() }
        }

        override fun onRouteStarted(routeStartInfo: ai.pleos.playground.navi.data.RouteStartInfo) {
            mainThread.post {
                if (closed) return@post
                routingComplete = false
                sendRoute()
            }
        }

        override fun onError(errorCode: NaviErrorCode) {
            mainThread.post {
                if (closed) return@post
                routingComplete = false
                sendError("NaviHelper: $errorCode")
                sendRoute()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        browser = WebView(this)
        browser.setBackgroundColor(Color.rgb(8, 12, 18))
        browser.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
        }
        // Only developer builds allow debugging. Never enable this in production.
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and 2) != 0)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        browser.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
                val target = request.url
                if (target.scheme == "https" && target.host == "appassets.androidplatform.net" &&
                    target.path?.startsWith("/assets/moment/") == true) return false
                // An article/restaurant link opens in a separate browser, never in
                // the privileged MOMENT WebView (which receives native events).
                if (request.isForMainFrame && target.scheme == "https") {
                    try { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                    catch (_: ActivityNotFoundException) { sendError("외부 브라우저를 열 수 없습니다.") }
                }
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                webReady = false
                pageLoaded = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pageLoaded = true
                if (!bridgeSupported) {
                    webReady = true
                    sendError("보안 WebMessage를 지원하지 않아 SDK 연결 없이 웹 데모만 사용합니다.")
                }
                flushEvents()
            }
        }
        browser.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?, filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (filePathCallback == null) return false
                pendingFileChooser?.onReceiveValue(null)
                pendingFileChooser = filePathCallback
                val chooseAudio = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "audio/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                return try {
                    startActivityForResult(Intent.createChooser(chooseAudio, "내 음악 파일 선택"), FILE_REQUEST_CODE)
                    true
                } catch (e: ActivityNotFoundException) {
                    pendingFileChooser?.onReceiveValue(null)
                    pendingFileChooser = null
                    sendError("음악 파일 선택 기능을 사용할 수 없습니다.")
                    false
                }
            }
        }
        bridgeSupported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        if (!bridgeSupported) {
            // Never silently use addJavascriptInterface (injected into all frames).
            // The app remains a web demo, WITHOUT privileged bridge semantics.
            sendError("이 WebView는 안전한 WebMessage 연결을 지원하지 않습니다.")
        } else {
            WebViewCompat.addWebMessageListener(browser, "MomentNativeBridge", setOf(BUNDLE_ORIGIN)) {
                _, message, sourceOrigin, isMainFrame, _ ->
                val currentUrl = browser.url.orEmpty()
                if (!isMainFrame || sourceOrigin.scheme != "https" ||
                    sourceOrigin.host != "appassets.androidplatform.net" ||
                    !currentUrl.startsWith("$BUNDLE_ORIGIN/assets/moment/")) return@addWebMessageListener
                val data = try { JSONObject(message.data ?: "") } catch (_: Exception) { return@addWebMessageListener }
                val command = data.optString("command")
                if (!BridgeContract.shouldAcceptCommand(data.optString("schema"), command, isMainFrame)) return@addWebMessageListener
                when (command) {
                    "ready" -> { webReady = true; sendConnection(); flushEvents() }
                    "refreshState" -> { refreshVehicle(); requestNavSnapshot() }
                }
            }
        }
        setContentView(browser)
        browser.loadUrl(APP_URL)
        initializeVehicle()
        initializeNavigation()
    }

    private fun initializeVehicle() {
        try {
            val sdk = Vehicle(applicationContext)
            vehicleSdk = sdk
            sdk.initialize()
            vehicleInitialized = true // Initialization call returned; NOT service-data confirmed.
            refreshVehicle()
        } catch (e: Exception) {
            vehicleReady = false
            sendError("Vehicle SDK 초기화 오류: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun refreshVehicle() {
        val sdk = vehicleSdk ?: return
        if (!vehicleInitialized) return
        try {
            // EV data are optional: ICE and unsupported hardware return no number.
            // The real SDK get API calls callbacks asynchronously.
            sdk.getEvBattery().getEvBatteryStateOfCharge(
                onComplete = { raw ->
                    mainThread.post {
                        if (closed) return@post
                        batteryPercent = BridgeContract.batteryPercentage(raw)
                        vehicleReady = batteryPercent != null
                        sendConnection()
                        sendVehicle()
                        if (batteryPercent == null) sendError("배터리 측정 단위 또는 값 미확인: 수치를 표시하지 않습니다.")
                    }
                },
                onFailed = { error ->
                    mainThread.post {
                        if (closed) return@post
                        vehicleReady = false
                        batteryPercent = null
                        sendConnection()
                        sendError("EV 배터리 API 조회 실패/미지원: ${error.message ?: error.javaClass.simpleName}")
                    }
                }
            )
        } catch (e: Exception) {
            vehicleReady = false
            sendConnection()
            sendError("EV 데이터 요청 거부: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun initializeNavigation() {
        try {
            val sdk = NaviHelper(applicationContext)
            naviSdk = sdk
            sdk.initialize(
                onConnected = {
                    mainThread.post {
                        if (closed) return@post
                        naviReady = true
                        try {
                            sdk.addListener(navListener)
                            naviListenerInstalled = true
                            sendConnection()
                            requestNavSnapshot()
                        } catch (e: Exception) {
                            naviReady = false
                            sendConnection()
                            sendError("NaviHelper 이벤트 구독 실패: ${e.message}")
                        }
                    }
                },
                onFailed = { error ->
                    mainThread.post {
                        if (closed) return@post
                        naviReady = false
                        sendConnection()
                        sendError("NaviHelper 서비스 연결 실패: ${error.message ?: error.javaClass.simpleName}")
                    }
                }
            )
        } catch (e: Exception) {
            naviReady = false
            sendConnection()
            sendError("NaviHelper 초기화 오류: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun requestNavSnapshot() {
        val sdk = naviSdk ?: return
        if (!naviReady) return
        try {
            sdk.getDestinationInfo()
            sdk.getRouteStateInfo()
        } catch (e: Exception) {
            sendError("내비게이션 정보 조회 실패: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun publicStringGetter(value: Any, method: String): String? = try {
        // Read public, documented POI data only. Avoid leaking raw SDK models,
        // location coordinates, trip histories, VIN or health data to the UI.
        value.javaClass.methods.firstOrNull { it.name == method && it.parameterCount == 0 }
            ?.invoke(value) as? String
    } catch (_: Exception) { null }

    private fun sendConnection() = send(JSONObject().apply {
        put("schema", BridgeContract.EVENT_SCHEMA)
        put("type", "connected")
        put("vehicleReady", vehicleReady)
        put("naviReady", naviReady)
    })

    private fun sendVehicle() = send(JSONObject().apply {
        put("schema", BridgeContract.EVENT_SCHEMA)
        put("type", "vehicle")
        put("batteryPercent", batteryPercent ?: JSONObject.NULL)
        put("rangeKm", JSONObject.NULL) // RangeRemaining unit/API not validated.
    })

    private fun sendRoute() = send(JSONObject().apply {
        put("schema", BridgeContract.EVENT_SCHEMA)
        put("type", "route")
        put("remainingMinutes", JSONObject.NULL) // Do not guess SDK raw-time units.
        put("destinationName", destinationName ?: JSONObject.NULL)
        put("routingCompleted", naviReady && routingComplete && destinationName != null)
    })

    private fun sendError(message: String) = send(JSONObject().apply {
        put("schema", BridgeContract.EVENT_SCHEMA)
        put("type", "error")
        put("message", message.take(120))
    })

    private fun send(value: JSONObject) = mainThread.post {
        if (closed) return@post
        if (!webReady || !pageLoaded) {
            if (pendingEvents.size >= 24) pendingEvents.removeFirst()
            pendingEvents.addLast(value)
        } else {
            val encoded = JSONObject.quote(value.toString())
            browser.evaluateJavascript("window.__MOMENT_NATIVE_EVENT__ && window.__MOMENT_NATIVE_EVENT__($encoded);", null)
        }
    }

    private fun flushEvents() {
        if (!webReady || !pageLoaded || closed) return
        while (pendingEvents.isNotEmpty()) {
            val event = pendingEvents.removeFirst()
            val encoded = JSONObject.quote(event.toString())
            browser.evaluateJavascript("window.__MOMENT_NATIVE_EVENT__ && window.__MOMENT_NATIVE_EVENT__($encoded);", null)
        }
    }

    @Deprecated("startActivityForResult retained solely for API28-compatible WebView audio file picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_REQUEST_CODE) {
            val selected = if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null
            pendingFileChooser?.onReceiveValue(selected)
            pendingFileChooser = null
        }
    }

    override fun onDestroy() {
        closed = true
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        try {
            val navi = naviSdk
            if (naviListenerInstalled && navi != null) navi.removeListener(navListener)
            navi?.release()
        } catch (_: Exception) { }
        try { vehicleSdk?.release() } catch (_: Exception) { }
        browser.stopLoading()
        browser.loadUrl("about:blank")
        browser.destroy()
        super.onDestroy()
    }
}