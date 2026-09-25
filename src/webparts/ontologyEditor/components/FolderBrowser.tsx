/**
 * Pick a folder, on this site or another one.
 *
 * A typed path works and is what the editor used to require, but "Shared
 * Documents" has a space in it, folder names carry apostrophes and ampersands,
 * and a path that is subtly wrong fails at write time rather than at typing
 * time. Browsing removes that whole class of mistake.
 *
 * Cross-site is the point rather than a bonus: the editing site will be
 * restricted to authors and the viewer site readable by everyone, so the folder
 * Publish writes to is deliberately NOT on the site the editor runs on.
 */
import * as React from 'react';
import {
  Dialog, DialogType, DialogFooter, PrimaryButton, DefaultButton,
  TextField, MessageBar, MessageBarType, Spinner, SpinnerSize, Icon
} from '@fluentui/react';
import { FileService, ILibraryFolder, ILibraryFile } from '../../../services/sharepoint/FileService';

export const FolderBrowser: React.FC<{
  fileService: FileService;
  /** Absolute URL of the site to start on. */
  initialWebUrl: string;
  /** Server-relative folder to start in, if any. */
  initialFolder?: string;
  /**
   * Extensions to offer as selectable files, e.g. ['.sqlite']. Omit to pick a
   * folder instead. The same walk serves both: choosing a startup database and
   * choosing where to publish differ only in what you end up clicking.
   */
  selectFiles?: string[];
  /** Receives the chosen folder, or file, as a full https URL. */
  onPick: (absoluteUrl: string) => void;
  onCancel: () => void;
}> = ({ fileService, initialWebUrl, initialFolder, selectFiles, onPick, onCancel }) => {
  const [webUrl, setWebUrl] = React.useState(initialWebUrl.replace(/\/+$/, ''));
  // Committed separately from the text box: retyping a site URL character by
  // character must not fire a request per keystroke.
  const [activeWeb, setActiveWeb] = React.useState(initialWebUrl.replace(/\/+$/, ''));
  const [folder, setFolder] = React.useState<string | undefined>(initialFolder);
  const [entries, setEntries] = React.useState<ILibraryFolder[]>([]);
  const [files, setFiles] = React.useState<ILibraryFile[]>([]);
  const [chosenFile, setChosenFile] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const load = React.useCallback(async (web: string, path?: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      // No folder yet means "show me the libraries on this site" — a library's
      // root folder is just a folder, so navigation is uniform from there down.
      const list = path
        ? await fileService.listFolders(path, web)
        : await fileService.listLibraries(web);
      setEntries(list);
      // Files only exist inside a folder; the library list has none to show.
      setFiles(selectFiles && path ? await fileService.listFiles(path, selectFiles, web) : []);
    } catch (e) {
      setEntries([]);
      setFiles([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [fileService, selectFiles]);

  React.useEffect(() => { setChosenFile(undefined); void load(activeWeb, folder); }, [load, activeWeb, folder]);

  /** Server-relative path of the web, so "up" knows where to stop. */
  const webPath = React.useMemo((): string => {
    try { return decodeURIComponent(new URL(activeWeb).pathname).replace(/\/+$/, ''); }
    catch { return ''; }
  }, [activeWeb]);

  const origin = React.useMemo((): string => {
    try { return new URL(activeWeb).origin; } catch { return ''; }
  }, [activeWeb]);

  const goUp = (): void => {
    if (!folder) return;
    const parent = folder.substring(0, folder.lastIndexOf('/'));
    // Above the library root is the list of libraries, not the web's own folder.
    setFolder(parent && parent.length > webPath.length ? parent : undefined);
  };

  return (
    <Dialog
      hidden={false}
      onDismiss={onCancel}
      dialogContentProps={{
        type: DialogType.normal,
        title: selectFiles ? 'Choose a file' : 'Choose a folder',
        subText: selectFiles
          ? 'Pick the ontology to open when the page loads.'
          : 'Pick where the published copy is written. It can be on another site — ' +
            'readers need access there, and you need write access.'
      }}
      modalProps={{ isBlocking: true }}
      minWidth={640}
    >
      <TextField
        label="Site"
        value={webUrl}
        onChange={(_, v) => setWebUrl(v || '')}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            setFolder(undefined);
            setActiveWeb(webUrl.trim().replace(/\/+$/, ''));
          }
        }}
        description="Press Enter to browse a different site."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
        <DefaultButton
          text="Up"
          iconProps={{ iconName: 'Up' }}
          disabled={!folder || busy}
          onClick={goUp}
          styles={{ root: { height: 28 } }}
        />
        <div style={{ fontSize: 12, color: '#605e5c', flex: 1, wordBreak: 'break-all' }}>
          {folder || '(libraries on this site)'}
        </div>
      </div>

      {error && <MessageBar messageBarType={MessageBarType.error} isMultiline>{error}</MessageBar>}

      <div style={{ border: '1px solid #8a8886', borderRadius: 2, height: 240, overflowY: 'auto' }}>
        {busy && <div style={{ padding: 16 }}><Spinner size={SpinnerSize.medium} label="Loading…" /></div>}
        {!busy && entries.length === 0 && !error && (
          <div style={{ padding: 16, color: '#605e5c', fontSize: 13 }}>
            {selectFiles ? 'Nothing here to open.' : 'No sub-folders here. You can still choose this folder.'}
          </div>
        )}
        {!busy && entries.map(e => (
          <div
            key={e.serverRelativeUrl}
            onClick={() => setFolder(e.serverRelativeUrl)}
            onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') setFolder(e.serverRelativeUrl); }}
            role="button"
            tabIndex={0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #edebe9'
            }}
          >
            <Icon iconName={folder ? 'FabricFolder' : 'DocumentSet'} style={{ color: '#605e5c' }} />
            <span style={{ fontSize: 13 }}>{e.name}</span>
          </div>
        ))}
        {!busy && files.map(f => (
          <div
            key={f.serverRelativeUrl}
            onClick={() => setChosenFile(f.serverRelativeUrl)}
            onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') setChosenFile(f.serverRelativeUrl); }}
            role="button"
            tabIndex={0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer',
              borderBottom: '1px solid #edebe9',
              background: chosenFile === f.serverRelativeUrl ? '#deecf9' : undefined
            }}
          >
            <Icon iconName="Database" style={{ color: '#605e5c' }} />
            <span style={{ fontSize: 13, flex: 1 }}>{f.name}</span>
            <span style={{ fontSize: 11, color: '#605e5c' }}>{Math.round(f.size / 1024)} KB</span>
          </div>
        ))}
      </div>

      <DialogFooter>
        <PrimaryButton
          text={selectFiles ? 'Use this file' : 'Use this folder'}
          disabled={busy || (selectFiles ? !chosenFile : !folder)}
          onClick={() => {
            if (selectFiles) { if (chosenFile) onPick(`${origin}${chosenFile}`); }
            else if (folder) onPick(`${origin}${folder}`);
          }}
        />
        <DefaultButton text="Cancel" onClick={onCancel} />
      </DialogFooter>
    </Dialog>
  );
};

export default FolderBrowser;
