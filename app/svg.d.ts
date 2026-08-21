declare module '*.svg' {
  import type React from 'react';
  import type { SvgProps } from 'react-native-svg';
  const contenido: React.FC<SvgProps>;
  export default contenido;
}
