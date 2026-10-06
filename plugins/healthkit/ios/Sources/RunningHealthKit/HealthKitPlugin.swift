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
        CAPPluginMethod(name: "readRuns", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveRun", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    private let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!
    private let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    private let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let routeType = HKSeriesType.workoutRoute()

    private var readTypes: Set<HKObjectType> {
        [HKObjectType.workoutType(), distanceType, energyType, heartRateType, routeType]
    }

    private var writeTypes: Set<HKSampleType> {
        [HKObjectType.workoutType(), distanceType, energyType, heartRateType, routeType]
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("이 기기에서는 Apple 건강을 사용할 수 없습니다.")
            return
        }

        healthStore.requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
            if let error = error {
                call.reject("건강 권한 요청에 실패했습니다.", nil, error)
                return
            }
            call.resolve(["authorized": success])
        }
    }

    @objc func readRuns(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("이 기기에서는 Apple 건강을 사용할 수 없습니다.")
            return
        }

        let days = min(max(call.getInt("days") ?? 365, 1), 3650)
        let includeRoutes = call.getBool("includeRoutes") ?? true
        let startDate = Calendar.current.date(byAdding: .day, value: -days, to: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: nil, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: 200,
            sortDescriptors: [sort]
        ) { [weak self] _, samples, error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Apple 건강의 러닝 기록을 불러오지 못했습니다.", nil, error)
                return
            }

            let workouts = (samples as? [HKWorkout] ?? []).filter { $0.workoutActivityType == .running }
            var runs = workouts.map { self.runObject(from: $0) }
            guard includeRoutes, !workouts.isEmpty else {
                call.resolve(["runs": runs])
                return
            }

            let group = DispatchGroup()
            let lock = NSLock()
            for (index, workout) in workouts.enumerated() {
                group.enter()
                self.loadRoute(for: workout) { coordinates in
                    lock.lock()
                    runs[index]["coords"] = coordinates
                    lock.unlock()
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                call.resolve(["runs": runs])
            }
        }
        healthStore.execute(query)
    }

    @objc func saveRun(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("이 기기에서는 Apple 건강을 사용할 수 없습니다.")
            return
        }
        guard let dateValue = call.getString("date"),
              let start = parseISODate(dateValue),
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
                call.reject("운동 기록 시작에 실패했습니다.", nil, error)
                return
            }

            var samples: [HKSample] = [
                HKQuantitySample(
                    type: self.distanceType,
                    quantity: HKQuantity(unit: .meter(), doubleValue: distanceKm * 1000),
                    start: start,
                    end: end
                )
            ]
            if let calories = call.getDouble("calories"), calories > 0 {
                samples.append(HKQuantitySample(
                    type: self.energyType,
                    quantity: HKQuantity(unit: .kilocalorie(), doubleValue: calories),
                    start: start,
                    end: end
                ))
            }
            if let bpm = call.getDouble("hr"), bpm > 0 {
                let unit = HKUnit.count().unitDivided(by: .minute())
                samples.append(HKQuantitySample(
                    type: self.heartRateType,
                    quantity: HKQuantity(unit: unit, doubleValue: bpm),
                    start: start,
                    end: end
                ))
            }

            self.addMetadata(call: call, builder: builder) {
                builder.add(samples) { added, addError in
                    guard added else {
                        call.reject("운동 지표 저장에 실패했습니다.", nil, addError)
                        return
                    }
                    builder.endCollection(withEnd: end) { ended, endError in
                        guard ended else {
                            call.reject("운동 기록 종료에 실패했습니다.", nil, endError)
                            return
                        }
                        builder.finishWorkout { workout, finishError in
                            guard let workout = workout else {
                                call.reject("운동 저장에 실패했습니다.", nil, finishError)
                                return
                            }
                            self.saveRouteIfPresent(call: call, workout: workout, start: start) { routeSaved, warning in
                                var result: JSObject = [
                                    "saved": true,
                                    "routeSaved": routeSaved,
                                    "workoutId": workout.uuid.uuidString
                                ]
                                if let warning = warning { result["warning"] = warning }
                                call.resolve(result)
                            }
                        }
                    }
                }
            }
        }
    }

    private func runObject(from workout: HKWorkout) -> JSObject {
        let distanceMeters = workout.statistics(for: distanceType)?.sumQuantity()?.doubleValue(for: .meter()) ?? 0
        let calories = workout.statistics(for: energyType)?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
        let heartUnit = HKUnit.count().unitDivided(by: .minute())
        let heartRate = workout.statistics(for: heartRateType)?.averageQuantity()?.doubleValue(for: heartUnit) ?? 0
        let distanceKm = distanceMeters / 1000
        let startedAt = ISO8601DateFormatter().string(from: workout.startDate)
        return [
            "id": "healthkit-\(workout.uuid.uuidString)",
            "date": startedAt,
            "startedAt": startedAt,
            "distance": distanceKm,
            "duration": workout.duration,
            "pace": distanceKm > 0 ? workout.duration / 60 / distanceKm : 0,
            "hr": heartRate.rounded(),
            "calories": calories.rounded(),
            "note": "Apple Watch Run",
            "source": "healthkit"
        ]
    }

    private func loadRoute(for workout: HKWorkout, completion: @escaping (JSArray) -> Void) {
        let predicate = HKQuery.predicateForObjects(from: workout)
        let query = HKSampleQuery(
            sampleType: routeType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { [weak self] _, samples, _ in
            guard let self = self, let routes = samples as? [HKWorkoutRoute], !routes.isEmpty else {
                completion([])
                return
            }

            let group = DispatchGroup()
            let lock = NSLock()
            var locations: [CLLocation] = []
            for route in routes {
                group.enter()
                let routeQuery = HKWorkoutRouteQuery(route: route) { _, batch, done, error in
                    if let batch = batch {
                        lock.lock()
                        locations.append(contentsOf: batch)
                        lock.unlock()
                    }
                    if done || error != nil { group.leave() }
                }
                self.healthStore.execute(routeQuery)
            }
            group.notify(queue: .global(qos: .userInitiated)) {
                let result: JSArray = locations
                    .sorted { $0.timestamp < $1.timestamp }
                    .map { location in
                        [
                            "lat": location.coordinate.latitude,
                            "lng": location.coordinate.longitude,
                            "elevation": location.altitude,
                            "time": ISO8601DateFormatter().string(from: location.timestamp)
                        ] as JSObject
                    }
                completion(result)
            }
        }
        healthStore.execute(query)
    }

    private func addMetadata(call: CAPPluginCall, builder: HKWorkoutBuilder, completion: @escaping () -> Void) {
        guard let externalId = call.getString("externalId"), !externalId.isEmpty else {
            completion()
            return
        }
        builder.addMetadata([HKMetadataKeyExternalUUID: externalId]) { _, _ in completion() }
    }

    private func saveRouteIfPresent(
        call: CAPPluginCall,
        workout: HKWorkout,
        start: Date,
        completion: @escaping (Bool, String?) -> Void
    ) {
        guard let values = call.getArray("coords"), values.count > 1 else {
            completion(false, nil)
            return
        }
        let interval = max(1, workout.duration / Double(values.count - 1))
        let locations = values.enumerated().compactMap { index, value -> CLLocation? in
            guard let point = value as? JSObject,
                  let lat = numericValue(point["lat"]),
                  let lng = numericValue(point["lng"]) else { return nil }
            let elevation = numericValue(point["elevation"]) ?? 0
            let timestamp = (point["time"] as? String).flatMap(parseISODate)
                ?? start.addingTimeInterval(Double(index) * interval)
            return CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                altitude: elevation,
                horizontalAccuracy: 10,
                verticalAccuracy: 10,
                timestamp: timestamp
            )
        }
        guard locations.count > 1 else {
            completion(false, "경로 좌표가 부족해 운동 요약만 저장했습니다.")
            return
        }

        let routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: .local())
        routeBuilder.insertRouteData(locations) { success, error in
            guard success else {
                completion(false, error?.localizedDescription ?? "경로 저장에 실패했습니다.")
                return
            }
            routeBuilder.finishRoute(with: workout, metadata: nil) { route, finishError in
                completion(route != nil, finishError?.localizedDescription)
            }
        }
    }
}

private func numericValue(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    return value as? Double
}

private func parseISODate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
