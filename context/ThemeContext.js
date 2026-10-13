import React, {
  createContext,
  useContext,
} from 'react';

import {
  THEME_COLORS,
} from '../constants/colors';

export const ThemeContext =
  createContext({
    isDarkMode: false,
    colors: THEME_COLORS.light,
    toggleTheme: () => {},
  });

export const useTheme = () =>
  useContext(ThemeContext);
