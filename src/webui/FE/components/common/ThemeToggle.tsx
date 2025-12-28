import React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '../../stores/themeStore'

const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useThemeStore()

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg transition-all duration-200
        text-theme-muted
        hover:bg-theme-item
        hover:text-theme"
      title={isDark ? '切换到亮色模式' : '切换到暗黑模式'}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}

export default ThemeToggle
