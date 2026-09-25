/**
 * The editor's own configuration panel, in place of the built-in property pane.
 *
 * Follows ~/.claude/notes/sharepoint-custom-config-panel-pattern.md, with one
 * deliberate omission: that pattern injects a gear into SharePoint's web part
 * toolbar, because on an ordinary page an author has to select the right web
 * part first. This editor is a full-page web part — there is nothing else on the
 * page to select — so the entry point is a command in its own command bar, and
 * the toolbar injection (the fragile half, which cost two build cycles there) is
 * not needed at all.
 *
 * What the pattern still requires and this keeps:
 *   - the standard property pane stays working as the supported fallback
 *   - the entry control toggles rather than reopening
 *   - closing is the author's choice; nothing closes it as a side effect
 */
import * as React from 'react';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { TextField, DefaultButton, MessageBar, MessageBarType, Separator } from '@fluentui/react';
import { FileService } from '../../../services/sharepoint/FileService';
import FolderBrowser from './FolderBrowser';

export interface ISettingsPanelProps {
  isOpen: boolean;
  onDismiss: () => void;
  fileService?: FileService;
  /** Absolute URL of the site the editor is running on. */
  siteUrl: string;
  libraryFolder: string;
  publishFolder: string;
  databaseUrl: string;
  /**
   * True when the page is in edit mode. The panel no longer renders outside it
   * (the entry points are gated), so this is kept only so callers state the
   * precondition explicitly rather than relying on it implicitly.
   */
  isEditMode: boolean;
  /** Writes straight back to the web part's properties. */
  onPropertyChange: (property: string, value: string) => void;
}

/** Which field the folder browser is currently choosing for. */
type Browsing = 'libraryFolder' | 'publishFolder' | 'databaseUrl' | undefined;

export const SettingsPanel: React.FC<ISettingsPanelProps> = (props) => {
  const {
    isOpen, onDismiss, fileService, siteUrl,
    libraryFolder, publishFolder, databaseUrl, onPropertyChange
  } = props;

  const [browsing, setBrowsing] = React.useState<Browsing>(undefined);

  /**
   * A browsed folder comes back absolute. Keep it that way for the publish
   * folder — it may legitimately be on another site — but store a same-site
   * library folder as server-relative, which is the form the rest of the editor
   * already reads and what the property's own description promises.
   */
  const applyFolder = (which: Exclude<Browsing, undefined>, absolute: string): void => {
    if (which === 'databaseUrl') {
      // This one is documented as server-relative and is only ever opened from
      // the site the editor runs on, so store it in the form the loader expects.
      let value = absolute;
      try { value = decodeURIComponent(new URL(absolute).pathname); } catch { /* keep as typed */ }
      onPropertyChange('databaseUrl', value);
    } else {
      // Both folder fields store the same shape. A server-relative path already
      // names the site (/sites/<name>/...), so the host adds nothing while the
      // editor and viewer sites are in one tenant — which they always are.
      let value = absolute;
      try {
        const u = new URL(absolute);
        if (u.origin === new URL(siteUrl).origin) value = decodeURIComponent(u.pathname);
      } catch { /* leave it absolute if it will not parse */ }
      onPropertyChange(which, value);
    }
    setBrowsing(undefined);
  };

  const folderField = (
    label: string,
    which: Exclude<Browsing, undefined>,
    value: string,
    description: string
  ): JSX.Element => (
    <div style={{ marginBottom: 14 }}>
      <TextField
        label={label}
        value={value}
        onChange={(_, v) => onPropertyChange(which, v || '')}
        description={description}
      />
      <DefaultButton
        text="Browse…"
        iconProps={{ iconName: 'FolderOpen' }}
        disabled={!fileService}
        onClick={() => setBrowsing(which)}
        styles={{ root: { marginTop: 6, height: 28 } }}
      />
    </div>
  );

  return (
    <>
      <Panel
        isOpen={isOpen}
        onDismiss={onDismiss}
        type={PanelType.medium}
        headerText="Ontology editor settings"
        closeButtonAriaLabel="Close settings"
        // isBlocking={false} renders no overlay, so light dismiss never fires and
        // nothing closes the panel for you. See the pattern note.
        isBlocking={false}
        isLightDismiss
        // The Panel's ROOT is a fixed container spanning the whole viewport, not
        // just the visible pane on the right. Without this it silently swallows
        // every click on the page behind it — including the Settings button that
        // opened it, so the toggle could open but never close. Transparent to
        // pointers at the root, opaque again on the pane itself.
        styles={{
          root: { pointerEvents: 'none' },
          main: { pointerEvents: 'auto' }
        }}
      >
        {!fileService && (
          <MessageBar messageBarType={MessageBarType.warning} isMultiline>
            No SharePoint context, so folders cannot be browsed. Paths can still be typed.
          </MessageBar>
        )}

        <p style={{ fontSize: 13, color: '#605e5c' }}>
          Changes apply immediately to this session.
        </p>

        {/* Unreachable outside edit mode now — the entry points are gated — but
            the reminder still matters: applying is not the same as persisting. */}
        <MessageBar messageBarType={MessageBarType.info} isMultiline>
          These settings are stored in the page. <strong>Republish the page</strong> to
          keep them; closing this panel alone does not save anything.
        </MessageBar>

        <Separator>Where files live</Separator>

        {folderField(
          'Library folder',
          'libraryFolder',
          libraryFolder,
          'Where the editor browses for ontologies and saves the master. Blank uses ' +
          'Shared Documents/Ontology on this site.'
        )}

        {folderField(
          'Publish folder',
          'publishFolder',
          publishFolder,
          'Where Publish writes the copy the viewer reads. Blank puts it beside the ' +
          'master, which is fine for a trial but wrong once authors and readers need ' +
          'different permissions. May be on another site.'
        )}

        {libraryFolder && publishFolder && sameFolder(libraryFolder, publishFolder, siteUrl) && (
          <MessageBar messageBarType={MessageBarType.warning} isMultiline>
            The publish folder is the same as the library folder, so published copies
            land beside the masters. Readers of the published file can then see work in
            progress too.
          </MessageBar>
        )}

        <Separator>Startup</Separator>

        <TextField
          label="Database URL"
          value={databaseUrl}
          onChange={(_, v) => onPropertyChange('databaseUrl', v || '')}
          description="A .sqlite to open automatically. Blank shows the picker."
        />
        <DefaultButton
          text="Browse…"
          iconProps={{ iconName: 'OpenFile' }}
          disabled={!fileService}
          onClick={() => setBrowsing('databaseUrl')}
          styles={{ root: { marginTop: 6, height: 28 } }}
        />
      </Panel>

      {browsing && fileService && (
        <FolderBrowser
          fileService={fileService}
          initialWebUrl={siteUrl}
          initialFolder={startFolderFor(
            browsing === 'publishFolder' ? publishFolder
            : browsing === 'databaseUrl' ? (startFolderOfFile(databaseUrl) || libraryFolder)
            : libraryFolder
          )}
          selectFiles={browsing === 'databaseUrl' ? ['.sqlite'] : undefined}
          onPick={(abs) => applyFolder(browsing, abs)}
          onCancel={() => setBrowsing(undefined)}
        />
      )}
    </>
  );
};

/** The folder containing a stored file path, so Browse opens where it already points. */
function startFolderOfFile(value: string): string | undefined {
  const v = (value || '').trim();
  if (!v) return undefined;
  const path = /^https?:\/\//i.test(v)
    ? (() => { try { return decodeURIComponent(new URL(v).pathname); } catch { return ''; } })()
    : v;
  const cut = path.lastIndexOf('/');
  return cut > 0 ? path.substring(0, cut) : undefined;
}

/** Server-relative starting point from a stored value, which may be absolute. */
function startFolderFor(value: string): string | undefined {
  const v = (value || '').trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) {
    try { return decodeURIComponent(new URL(v).pathname); } catch { return undefined; }
  }
  return v;
}

/** Do two folder settings resolve to the same place? */
function sameFolder(a: string, b: string, siteUrl: string): boolean {
  const norm = (v: string): string => {
    const t = (v || '').trim().replace(/\/+$/, '');
    if (!t) return '';
    try {
      const u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`${siteUrl.replace(/\/+$/, '')}${t.startsWith('/') ? '' : '/'}${t}`);
      return `${u.origin}${decodeURIComponent(u.pathname)}`.toLowerCase();
    } catch {
      return t.toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

export default SettingsPanel;
