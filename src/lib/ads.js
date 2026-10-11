import { Capacitor } from '@capacitor/core'
import {
  AdMob,
  AdmobConsentStatus,
  NativeAdFeed,
  NativeAdPluginEvents,
  NativeAdTemplate,
} from '@capacitor-community/admob'

const IOS_NATIVE_AD_ID = 'ca-app-pub-7046263157049760/9828527121'
const IOS_REWARDED_AD_ID = 'ca-app-pub-7046263157049760/3092651825'

let initialization

export async function initializeAds() {
  if (Capacitor.getPlatform() !== 'ios') return false
  if (!initialization) {
    initialization = (async () => {
      let consent = await AdMob.requestConsentInfo({ tagForUnderAgeOfConsent: false })
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm()
      }
      if (!consent.canRequestAds) return false
      await AdMob.initialize()
      return true
    })().catch(() => false)
  }
  return initialization
}

export async function createHomeNativeAd(scrollElement, { onLoaded, onFailed } = {}) {
  const feed = await NativeAdFeed.create({
    feedId: 'simply-run-home-feed',
    adId: IOS_NATIVE_AD_ID,
    template: NativeAdTemplate.Medium,
    isTesting: false,
    npa: true,
    scrollElement,
    style: {
      backgroundColor: '#131518', borderColor: '#292d32', borderWidth: 1, cornerRadius: 5,
      headlineColor: '#f4f4ef', headlineFontSize: 16, bodyColor: '#858b93', bodyFontSize: 11,
      callToActionBackgroundColor: '#b8ff34', callToActionTextColor: '#0a0b0d', callToActionFontSize: 13,
    },
  })
  const handles = []
  if (onLoaded) handles.push(await feed.addListener(NativeAdPluginEvents.Loaded, onLoaded))
  if (onFailed) handles.push(await feed.addListener(NativeAdPluginEvents.FailedToLoad, onFailed))
  return {
    invalidateLayout: () => feed.invalidateLayout(),
    async destroy() {
      await Promise.allSettled(handles.map((handle) => handle.remove()))
      await feed.destroy()
    },
  }
}

export async function showRewardedInsightAd() {
  await AdMob.prepareRewardVideoAd({ adId: IOS_REWARDED_AD_ID, isTesting: false, npa: true })
  return AdMob.showRewardVideoAd({ adId: IOS_REWARDED_AD_ID })
}

export async function showAdPrivacyOptions() {
  if (Capacitor.getPlatform() !== 'ios') return false
  await AdMob.showPrivacyOptionsForm()
  return true
}
