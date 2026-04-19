import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#1a1a1a",
          borderTopColor: "#2a2a2a",
          height: 64,
          paddingBottom: 8,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="library" size={24} color={focused ? "#f59e0b" : "#666"} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => (
            <Ionicons name="settings-outline" size={24} color={focused ? "#f59e0b" : "#666"} />
          ),
        }}
      />
    </Tabs>
  );
}
