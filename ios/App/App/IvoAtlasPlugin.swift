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
        CAPPluginMethod(name: "finishSuspend", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "com.paulcantrell.ivo.atlas", qos: .userInitiated)
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
    private func invalidCall() -> NSError {
        NSError(domain: "Ivo.Atlas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid native atlas request."])
    }
}
