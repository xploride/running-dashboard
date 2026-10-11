import UIKit
import Capacitor

final class SimplyRunViewController: CAPBridgeViewController {
    private let appBackground = UIColor(red: 10 / 255, green: 11 / 255, blue: 13 / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = appBackground
        bridge?.webView?.isOpaque = false
        bridge?.webView?.backgroundColor = appBackground
        bridge?.webView?.scrollView.backgroundColor = appBackground
        bridge?.webView?.scrollView.bounces = false
        bridge?.webView?.scrollView.alwaysBounceVertical = false
        bridge?.webView?.scrollView.alwaysBounceHorizontal = false
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = UIColor(red: 10 / 255, green: 11 / 255, blue: 13 / 255, alpha: 1)
        window?.rootViewController = SimplyRunViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
