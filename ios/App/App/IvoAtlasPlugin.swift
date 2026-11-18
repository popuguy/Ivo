import Foundation
import Capacitor
import UIKit

@objc(IvoAtlasPlugin)
public final class IvoAtlasPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IvoAtlasPlugin"
    public let jsName = "IvoAtlas"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hash", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishSuspend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFonts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFont", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "composeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "textPDF", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "com.paulcantrell.ivo.atlas", qos: .userInitiated)
    private let compositionQueue = DispatchQueue(label: "com.paulcantrell.ivo.text", qos: .userInitiated)
    private let textComposition = TextCompositionEngine()
    private var atlas: AtlasFiles?
    private var observer: NSObjectProtocol?
    private var suspendToken: String?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    public override func load() {
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.prepareSuspend()
        }
    }
    deinit { if let observer = observer { NotificationCenter.default.removeObserver(observer) } }
    private func prepareSuspend() {
        guard backgroundTask == .invalid else { return }
        let token = UUID().uuidString
        suspendToken = token
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save Ivo atlas") { [weak self] in
            self?.endBackgroundSave()
        }
        notifyListeners("prepareSuspend", data: ["token": token], retainUntilConsumed: true)
    }
    private func endBackgroundSave() {
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
        suspendToken = nil
    }
    @objc func finishSuspend(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if call.getString("token") == self.suspendToken { self.endBackgroundSave() }
            call.resolve()
        }
    }
    @objc func initialize(_ call: CAPPluginCall) {
        queue.async {
            do {
                let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let atlas = self.atlas ?? AtlasFiles(directory: documents.appendingPathComponent("Ivo Atlas", isDirectory: true))
                try atlas.initialize()
                self.atlas = atlas
                call.resolve(["directory": atlas.directory.path])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func read(_ call: CAPPluginCall) {
        queue.async {
            do {
                guard let atlas = self.atlas, let path = call.getString("path") else { throw self.invalidCall() }
                if let data = try atlas.read(path) { call.resolve(["data": data.base64EncodedString()]) }
                else { call.resolve(["data": NSNull()]) }
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func write(_ call: CAPPluginCall) {
        queue.async {
            do {
                guard let atlas = self.atlas, let path = call.getString("path"),
                      let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else { throw self.invalidCall() }
                try atlas.writeAtomic(path, data: data, expectedHash: call.getString("expectedHash"))
                call.resolve()
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func hash(_ call: CAPPluginCall) {
        queue.async {
            guard let encoded=call.getString("data"), let data=Data(base64Encoded:encoded) else {
                call.reject("Invalid native hash request."); return
            }
            call.resolve(["sha256":AtlasFiles.digest(data)])
        }
    }
    @objc func listFonts(_ call: CAPPluginCall) {
        queue.async {
            do {
                let bytes = try JSONEncoder().encode(SystemFonts.list())
                let values = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] ?? []
                call.resolve(["fonts": values])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func readFont(_ call: CAPPluginCall) {
        queue.async {
            do {
                guard let name = call.getString("postscript") else { throw self.invalidCall() }
                let bytes = try JSONEncoder().encode(SystemFonts.read(name))
                let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] ?? [:]
                call.resolve(value)
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func composeText(_ call: CAPPluginCall) {
        guard let request = call.getString("request"), let data = request.data(using: .utf8),
              data.count <= 32 * 1024 * 1024 else {
            call.reject("Invalid native text request."); return
        }
        compositionQueue.async {
            do {
                let bytes = try self.textComposition.execute(data)
                guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
                    throw self.invalidCall()
                }
                call.resolve(value)
            } catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func textPDF(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), token.count == 68,
              token.range(of: "^ct1-[0-9a-f]{64}$", options: .regularExpression) != nil else {
            call.reject("Invalid composed text token."); return
        }
        let invisible = call.getBool("invisible") ?? true
        compositionQueue.async {
            do {
                let bytes = try self.textComposition.pdf(token: token, invisible: invisible)
                call.resolve(["data": bytes.base64EncodedString(), "mimeType": "application/pdf", "token": token])
            } catch { call.reject(error.localizedDescription) }
        }
    }
    private func invalidCall() -> NSError {
        NSError(domain: "Ivo.Atlas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid native atlas request."])
    }
}
