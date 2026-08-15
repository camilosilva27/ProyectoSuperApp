// react-native-web soporta estas dos propiedades de estilo (sacan el foco azul del
// navegador en los TextInput web), pero los tipos de `react-native` no las conocen.
import 'react-native';

declare module 'react-native' {
  interface TextStyle {
    outlineWidth?: number;
    outlineStyle?: 'none' | 'solid' | 'dotted' | 'dashed';
  }
}
