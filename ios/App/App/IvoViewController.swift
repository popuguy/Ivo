import Capacitor

final class IvoViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(IvoAtlasPlugin())
    }
}
