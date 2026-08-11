import * as React from 'react';
import {
  PrimaryButton, DefaultButton, TextField, Spinner, SpinnerSize,
  MessageBar, MessageBarType, Separator
} from '@fluentui/react';
import styles from './OntologyEditor.module.scss';
import { ILibraryFile } from '../../../services/sharepoint/FileService';

export type SourceKind = 'turtle-local' | 'turtle-library' | 'sqlite-local' | 'sqlite-library' | 'new';

export interface ISourceChoice {
  kind: SourceKind;
  /** For the *-local kinds. */
  file?: File;
  /** For the *-library kinds: server-relative path. */
  path?: string;
}

export interface ISourcePickerProps {
  /** Default library folder from the property pane. */
  libraryFolder: string;
  /** Lists .ttl/.sqlite files in a folder; undefined when there is no SharePoint context. */
  onBrowseLibrary?: (folder: string) => Promise<ILibraryFile[]>;
  onChoose: (choice: ISourceChoice) => void;
  /** Non-fatal message from a previous attempt. */
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * First-run chooser: build the database from a Turtle export, or open one that
 * was built earlier.
 *
 * Importing is deliberately presented as the slower path, because it is —
 * parsing 200,000 triples takes tens of seconds and freezes the tab. Opening a
 * prepared .sqlite is near-instant, so it is the default.
 */
const SourcePicker: React.FC<ISourcePickerProps> = (props) => {
  const { libraryFolder, onBrowseLibrary, onChoose, error } = props;

  const [folder, setFolder] = React.useState<string>(libraryFolder || '');
  const [files, setFiles] = React.useState<ILibraryFile[] | undefined>(undefined);
  const [browsing, setBrowsing] = React.useState<boolean>(false);
  const [browseError, setBrowseError] = React.useState<string | undefined>(undefined);

  const ttlInput = React.useRef<HTMLInputElement>(null);
  const sqliteInput = React.useRef<HTMLInputElement>(null);

  const browse = React.useCallback(async (): Promise<void> => {
    if (!onBrowseLibrary || !folder.trim()) return;
    setBrowsing(true);
    setBrowseError(undefined);
    try {
      setFiles(await onBrowseLibrary(folder.trim()));
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e));
      setFiles(undefined);
    } finally {
      setBrowsing(false);
    }
  }, [folder, onBrowseLibrary]);

  // List the default folder immediately — a returning user's first question is
  // "where is the file I saved?". A folder that does not exist yet (nothing
  // saved on this site) is normal, so that error stays quiet.
  const autoBrowsed = React.useRef(false);
  React.useEffect(() => {
    if (autoBrowsed.current || !onBrowseLibrary || !folder.trim()) return;
    autoBrowsed.current = true;
    setBrowsing(true);
    onBrowseLibrary(folder.trim())
      .then(f => { setFiles(f); setBrowsing(false); })
      .catch(() => { setFiles(undefined); setBrowsing(false); });
  }, [onBrowseLibrary, folder]);

  const pickLocal = (input: HTMLInputElement | null, kind: SourceKind): void => {
    const file = input && input.files && input.files[0];
    if (file) onChoose({ kind, file });
  };

  const isTurtle = (name: string): boolean => /\.ttl$/i.test(name);

  return (
    <div className={styles.sourcePicker}>
      <h2>Open an ontology</h2>

      {error && <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>}

      <div className={styles.sourceOptions}>
        {/* ---- Open a prepared database ---- */}
        <section className={styles.sourceCard}>
          <h3>Open a database</h3>
          <p className={styles.muted}>
            A <code>.sqlite</code> built earlier. Opens immediately.
          </p>

          <DefaultButton
            text="Choose a .sqlite file…"
            iconProps={{ iconName: 'Database' }}
            onClick={() => sqliteInput.current && sqliteInput.current.click()}
          />
          <input
            ref={sqliteInput}
            type="file"
            accept=".sqlite,.db"
            style={{ display: 'none' }}
            onChange={() => pickLocal(sqliteInput.current, 'sqlite-local')}
          />
        </section>

        {/* ---- Build from Turtle ---- */}
        <section className={styles.sourceCard}>
          <h3>Import a Turtle export</h3>
          <p className={styles.muted}>
            Builds the database from a Semaphore <code>.ttl</code>.
          </p>
          <MessageBar messageBarType={MessageBarType.info} isMultiline>
            Reads about 200,000 statements — a few seconds, during which the tab
            stops responding. Save the result afterwards to skip it next time.
          </MessageBar>

          <DefaultButton
            text="Choose a .ttl file…"
            iconProps={{ iconName: 'Import' }}
            onClick={() => ttlInput.current && ttlInput.current.click()}
          />
          <input
            ref={ttlInput}
            type="file"
            accept=".ttl,.turtle,text/turtle"
            style={{ display: 'none' }}
            onChange={() => pickLocal(ttlInput.current, 'turtle-local')}
          />
        </section>

        {/* ---- Start from scratch ---- */}
        <section className={styles.sourceCard}>
          <h3>Start a new ontology</h3>
          <p className={styles.muted}>
            An empty model. Define classes and relationship types on the Model
            tab, then add concepts. Save as <code>.sqlite</code> or export
            Turtle when done.
          </p>

          <DefaultButton
            text="Create a new ontology"
            iconProps={{ iconName: 'PageAdd' }}
            onClick={() => onChoose({ kind: 'new' })}
          />
        </section>
      </div>

      {onBrowseLibrary && (
        <>
          <Separator>or open from SharePoint</Separator>

          <div className={styles.libraryBrowser}>
            <TextField
              label="Library folder (server-relative)"
              value={folder}
              placeholder="/sites/knowledge/Shared Documents/ontology"
              onChange={(_, v) => setFolder(v || '')}
              onKeyDown={e => { if (e.key === 'Enter') void browse(); }}
            />
            <PrimaryButton text="Browse" onClick={() => void browse()} disabled={!folder.trim() || browsing} />
          </div>

          {browsing && <Spinner size={SpinnerSize.small} label="Listing files…" />}
          {browseError && <MessageBar messageBarType={MessageBarType.error}>{browseError}</MessageBar>}

          {files && files.length === 0 && (
            <MessageBar>No .ttl or .sqlite files in that folder.</MessageBar>
          )}

          {files && files.length > 0 && (
            <table className={styles.fileTable}>
              <thead>
                <tr><th>Name</th><th>Size</th><th>Modified</th><th /></tr>
              </thead>
              <tbody>
                {[...files]
                  .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
                  .map(f => (
                  <tr key={f.serverRelativeUrl}>
                    <td>{f.name}</td>
                    <td>{formatSize(f.size)}</td>
                    <td>{new Date(f.modified).toLocaleString()}</td>
                    <td>
                      <DefaultButton
                        text={isTurtle(f.name) ? 'Import' : 'Open'}
                        onClick={() => onChoose({
                          kind: isTurtle(f.name) ? 'turtle-library' : 'sqlite-library',
                          path: f.serverRelativeUrl
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};

export default SourcePicker;
