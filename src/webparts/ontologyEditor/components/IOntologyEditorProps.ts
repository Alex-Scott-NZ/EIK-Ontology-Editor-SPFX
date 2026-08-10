import { WebPartContext } from '@microsoft/sp-webpart-base';

export interface IOntologyEditorProps {
  /**
   * Server-relative URL of a .sqlite to open automatically on load. Leave blank
   * to always show the source picker.
   */
  databaseUrl: string;
  /**
   * Server-relative library folder used for browsing sources and for
   * "Save to library".
   */
  libraryFolder: string;
  isDarkTheme: boolean;
  context: WebPartContext;
}
