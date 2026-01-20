import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  autoHideSidebarInWebQQ: boolean
  setAutoHideSidebarInWebQQ: (value: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoHideSidebarInWebQQ: false,
      setAutoHideSidebarInWebQQ: (value: boolean) => set({ autoHideSidebarInWebQQ: value }),
    }),
    {
      name: 'llbot-settings',
    }
  )
)
