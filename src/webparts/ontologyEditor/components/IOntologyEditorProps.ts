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
  /**
   * Folder Publish writes the reader's copy to. Blank = same folder as the
   * master (historical behaviour). May be a full https URL to another site.
   */
  publishFolder: string;
  /**
   * Writes a value back to the web part's properties. Absent in hosts that do
   * not supply one, and the settings command hides itself when it is.
   */
  onPropertyChange?: (property: string, value: string) => void;
  /**
   * Called whenever the settings panel is opened.
   *
   * On a single-part App Page the host ignores direct writes to
   * `this.properties` — only a change originating in the PROPERTY PANE is
   * persisted. The web part therefore commits through a callback the pane
   * hands it, and that callback only exists while the pane is rendered. This
   * asks the web part to make sure the pane is open, so the commit channel is
   * live before the author changes anything. The pane sits behind the settings
   * panel and is never seen.
   */
  onSettingsOpened?: () => void;
  /** Increments when the property pane's button asks for the settings panel. */
  openSettingsToken?: number;
  /** True when the PAGE is in edit mode, so property changes can be persisted. */
  isEditMode?: boolean;
  isDarkTheme: boolean;
  context: WebPartContext;
}
