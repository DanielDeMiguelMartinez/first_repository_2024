import WidgetKit
import SwiftUI

// ─── Data model ───────────────────────────────────────────────────────────────
struct MacroEntry: TimelineEntry {
    let date: Date
    let cals: Int
    let calGoal: Int
    let protein: Int
    let carbs: Int
    let fat: Int
}

// ─── Timeline provider ────────────────────────────────────────────────────────
struct MacroProvider: TimelineProvider {
    let appGroup = "group.com.minutri.app"

    func placeholder(in context: Context) -> MacroEntry {
        MacroEntry(date: Date(), cals: 1200, calGoal: 2000, protein: 90, carbs: 150, fat: 45)
    }

    func getSnapshot(in context: Context, completion: @escaping (MacroEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MacroEntry>) -> Void) {
        let entry = readEntry()
        // Refresh every 30 minutes
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func readEntry() -> MacroEntry {
        let defaults = UserDefaults(suiteName: appGroup)
        return MacroEntry(
            date: Date(),
            cals:    defaults?.integer(forKey: "cals")    ?? 0,
            calGoal: defaults?.integer(forKey: "calGoal") ?? 2000,
            protein: defaults?.integer(forKey: "protein") ?? 0,
            carbs:   defaults?.integer(forKey: "carbs")   ?? 0,
            fat:     defaults?.integer(forKey: "fat")     ?? 0
        )
    }
}

// ─── Widget view ──────────────────────────────────────────────────────────────
struct MacroWidgetEntryView: View {
    var entry: MacroEntry
    @Environment(\.widgetFamily) var family

    var calPct: Double {
        guard entry.calGoal > 0 else { return 0 }
        return min(Double(entry.cals) / Double(entry.calGoal), 1.0)
    }
    var excedido: Bool { entry.cals > entry.calGoal }

    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.10, blue: 0.13)

            VStack(alignment: .leading, spacing: 6) {
                // Title
                HStack {
                    Text("🥗 Mi Nutri")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Text("\(entry.cals) kcal")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundColor(excedido ? .red : Color(red: 0.27, green: 0.86, blue: 0.50))
                }

                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.white.opacity(0.1))
                            .frame(height: 6)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(excedido ? Color.red : Color(red: 0.27, green: 0.53, blue: 1.0))
                            .frame(width: geo.size.width * CGFloat(calPct), height: 6)
                    }
                }
                .frame(height: 6)

                // Remaining / exceeded label
                Text(excedido
                     ? "+\(entry.cals - entry.calGoal) excedidas"
                     : "\(entry.calGoal - entry.cals) restantes de \(entry.calGoal)")
                    .font(.system(size: 10))
                    .foregroundColor(Color.white.opacity(0.5))

                // Macros row
                if family != .systemSmall {
                    HStack(spacing: 8) {
                        MacroCell(emoji: "💪", value: entry.protein, color: Color(red: 0.38, green: 0.65, blue: 0.98))
                        MacroCell(emoji: "⚡", value: entry.carbs,   color: Color(red: 0.98, green: 0.75, blue: 0.14))
                        MacroCell(emoji: "🫒", value: entry.fat,     color: Color(red: 0.97, green: 0.44, blue: 0.44))
                    }
                }
            }
            .padding(12)
        }
        .cornerRadius(16)
    }
}

struct MacroCell: View {
    let emoji: String
    let value: Int
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            Text(emoji).font(.system(size: 13))
            VStack(alignment: .leading, spacing: 1) {
                Text("\(value)g")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(color)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(6)
        .background(Color.white.opacity(0.05))
        .cornerRadius(8)
    }
}

// ─── Widget configuration ─────────────────────────────────────────────────────
@main
struct MacroWidget: Widget {
    let kind: String = "MacroWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MacroProvider()) { entry in
            MacroWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Mi Nutri — Macros")
        .description("Calorías y macros del día de un vistazo.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
