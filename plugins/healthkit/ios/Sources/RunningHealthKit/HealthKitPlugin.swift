import Capacitor
import CoreLocation
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveRun", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("이 기기에서는 Apple 건강을 사용할 수 없습니다.")
            return
        }

        let workout = HKObjectType.workoutType()
        let distance = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!
        let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)!
        let route = HKSeriesType.workoutRoute()
        let writeTypes: Set<HKSampleType> = [workout, distance, energy, heartRate, route]
        let readTypes: Set<HKObjectType> = [workout, distance, energy, heartRate, route]

        healthStore.requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
            if let error = error {
                call.reject("건강 권한 요청 실패", nil, error)
            } else {
                call.resolve(["authorized": success])
            }
        }
    }

    @objc func saveRun(_ call: CAPPluginCall) {
        guard let dateValue = call.getString("date"),
              let start = ISO8601DateFormatter().date(from: dateValue),
              let distanceKm = call.getDouble("distance"),
              let duration = call.getDouble("duration"),
              distanceKm > 0, duration > 0 else {
            call.reject("날짜, 거리, 시간이 필요합니다.")
            return
        }

        let end = start.addingTimeInterval(duration)
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .running
        configuration.locationType = call.getArray("coords")?.isEmpty == false ? .outdoor : .unknown
        let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: .local())

        builder.beginCollection(withStart: start) { [weak self] success, error in
            guard let self = self, success else {
                call.reject("운동 기록 시작 실패", nil, error)
                return
            }

            var samples: [HKSample] = []
            let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!
            samples.append(HKQuantitySample(type: distanceType, quantity: HKQuantity(unit: .meter(), doubleValue: distanceKm * 1000), start: start, end: end))

            if let calories = call.getDouble("calories"), calories > 0 {
                let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
                samples.append(HKQuantitySample(type: energyType, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: calories), start: start, end: end))
            }
            if let bpm = call.getDouble("hr"), bpm > 0 {
                let heartType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
                let unit = HKUnit.count().unitDivided(by: .minute())
                samples.append(HKQuantitySample(type: heartType, quantity: HKQuantity(unit: unit, doubleValue: bpm), start: start, end: end))
            }

            builder.add(samples) { added, addError in
                guard added else {
                    call.reject("운동 지표 저장 실패", nil, addError)
                    return
                }
                builder.endCollection(withEnd: end) { ended, endError in
                    guard ended else {
                        call.reject("운동 기록 종료 실패", nil, endError)
                        return
                    }
                    builder.finishWorkout { workout, finishError in
                        guard let workout = workout else {
                            call.reject("운동 저장 실패", nil, finishError)
                            return
                        }
                        self.saveRouteIfPresent(call: call, workout: workout, start: start) {
                            call.resolve(["saved": true, "workoutId": workout.uuid.uuidString])
                        }
                    }
                }
            }
        }
    }

    private func saveRouteIfPresent(call: CAPPluginCall, workout: HKWorkout, start: Date, completion: @escaping () -> Void) {
        guard let values = call.getArray("coords"), values.count > 1 else {
            completion()
            return
        }
        let interval = max(1, workout.duration / Double(values.count - 1))
        let locations = values.enumerated().compactMap { index, value -> CLLocation? in
            guard let point = value as? JSObject,
                  let lat = point["lat"] as? Double,
                  let lng = point["lng"] as? Double else { return nil }
            return CLLocation(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng), altitude: 0, horizontalAccuracy: 10, verticalAccuracy: 10, timestamp: start.addingTimeInterval(Double(index) * interval))
        }
        guard locations.count > 1 else { completion(); return }
        let routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
        routeBuilder.insertRouteData(locations) { success, _ in
            guard success else { completion(); return }
            routeBuilder.finishRoute(with: workout, metadata: nil) { _, _ in completion() }
        }
    }
}
