import { WebPartContext } from '@microsoft/sp-webpart-base';

export interface IOntologyEditorProps {
  /** Server-relative URL of the .sqlite file. */
  databaseUrl: string;
  isDarkTheme: boolean;
  context: WebPartContext;
}
