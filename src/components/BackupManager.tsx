import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, Card, Checkbox, Progress, Radio } from 'animal-island-ui'
import {
  exportBackup,
  restoreBackup,
  validateBackupFile,
  type BackupProgress,
  type RestoreReport,
  type ValidatedBackup
} from '../backup'
import { errorMessage } from '../api'
import { useTheme } from '../theme'
import { AppIcon } from './AppIcon'

function BackupSection({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  if (theme === 'animal-island') {
    return <Card className="account-section backup-manager" pattern="default" role="region" aria-label="数据备份与恢复">{children}</Card>
  }
  return <section className="account-section backup-manager">{children}</section>
}

function BackupPanel({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  if (theme === 'animal-island') return <Card className="backup-panel" pattern="default">{children}</Card>
  return <div className="backup-panel">{children}</div>
}

function formatBytes(value: number) {
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB'
  return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB'
}

function progressPercent(progress: BackupProgress | null) {
  if (!progress) return 0
  if (!progress.total) return 15
  return Math.max(2, Math.min(100, Math.round(progress.completed / progress.total * 100)))
}

export function BackupManager({ onRestored }: { onRestored: () => Promise<void> }) {
  const { theme } = useTheme()
  const [includeOriginals, setIncludeOriginals] = useState(true)
  const [backup, setBackup] = useState<ValidatedBackup | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [report, setReport] = useState<RestoreReport | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const canStream = typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'

  function begin() {
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    setSuccess('')
    setReport(null)
    return controller
  }

  function finish() {
    controllerRef.current = null
    setBusy(false)
  }

  async function runExport(forceOriginals = false) {
    const controller = begin()
    try {
      const result = await exportBackup({
        includeOriginals: forceOriginals || includeOriginals,
        preferStreaming: true,
        signal: controller.signal,
        onProgress: setProgress
      })
      setSuccess('备份已生成：' + result.filename)
      return result
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') setError('操作已取消，没有修改数据。')
      else setError(errorMessage(requestError))
      return null
    } finally {
      finish()
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const controller = begin()
    try {
      const result = await validateBackupFile(file, setProgress)
      if (controller.signal.aborted) throw new DOMException('操作已取消', 'AbortError')
      setBackup(result)
      setSourceName(file.name)
      setSuccess('备份检查通过，可以选择恢复方式。')
    } catch (requestError) {
      setBackup(null)
      setSourceName('')
      setError(errorMessage(requestError))
    } finally {
      finish()
    }
  }

  async function runRestore() {
    if (!backup) return
    if (mode === 'replace') {
      const confirmed = window.confirm(
        '完整覆盖会替换当前所有类别、条目、图片和默认类别，但不会修改账号。系统会先生成一份包含原图的当前数据备份。确定继续吗？'
      )
      if (!confirmed) return
      const safety = await runExport(true)
      if (!safety) return
    }
    const controller = begin()
    try {
      const result = await restoreBackup(backup, mode, {
        signal: controller.signal,
        onProgress: setProgress
      })
      setReport(result)
      await onRestored()
      if (result.failed.length) {
        setError(
          mode === 'replace'
            ? '恢复过程中有条目失败，不能视为完整恢复。刚才生成的安全备份仍可用于再次恢复。'
            : '部分条目恢复失败，可根据下方报告修正后重试。'
        )
      } else {
        setSuccess(`恢复处理完成：新增 ${result.added} 条，跳过 ${result.skipped} 条。`)
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        setError(mode === 'replace' ? '恢复已中止。若清理已经开始，请使用刚生成的安全备份恢复。' : '恢复已取消。')
      } else {
        setError(errorMessage(requestError))
      }
    } finally {
      finish()
    }
  }

  const imageCount = backup?.manifest.items.reduce((sum, item) => sum + item.assets.filter((asset) => asset.path).length, 0) || 0
  const percent = progressPercent(progress)

  return (
    <BackupSection>
      <div className="account-section-heading">
        <AppIcon name="backup" size={24} />
        <div>
          <h3>数据备份与恢复</h3>
          <p>备份包含类别、条目、状态、日期、星标、今日计划、图片顺序和默认类别，不包含密码或登录信息。</p>
        </div>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}
      {busy && progress && (
        <div className="backup-progress" role="status">
          <span>{progress.message}</span>
          {theme === 'animal-island'
            ? <Progress percent={percent} infoPosition="right" />
            : <div className="quick-capture-progress"><i style={{ width: percent + '%' }} /></div>}
          <Button size="small" onClick={() => controllerRef.current?.abort()}>取消</Button>
        </div>
      )}

      <div className="backup-panels">
        <BackupPanel>
          <h4>导出备份</h4>
          {theme === 'animal-island' ? (
            <Checkbox
              options={[{ label: '包含全部原图（推荐）', value: 'images' }]}
              value={includeOriginals ? ['images'] : []}
              onChange={(values) => setIncludeOriginals(values.includes('images'))}
            />
          ) : (
            <label className="inline-check">
              <input type="checkbox" checked={includeOriginals} onChange={(event) => setIncludeOriginals(event.target.checked)} />
              包含全部原图（推荐）
            </label>
          )}
          <p className="muted">
            {canStream
              ? '当前浏览器支持边读取边保存，适合较大的图片备份。'
              : '当前浏览器会先在内存中生成完整 ZIP；超大备份建议改用 Windows Edge。'}
          </p>
          <Button type="primary" disabled={busy} icon={<AppIcon name="download" size={18} />} onClick={() => void runExport()}>
            导出 ZIP 备份
          </Button>
        </BackupPanel>

        <BackupPanel>
          <h4>恢复备份</h4>
          <Button disabled={busy} icon={<AppIcon name="upload" size={18} />} onClick={() => fileInputRef.current?.click()}>
            选择 ZIP 备份
          </Button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(event) => void chooseFile(event)}
          />
          {backup && (
            <div className="backup-summary">
              <strong>{sourceName}</strong>
              <span>{backup.manifest.items.length} 条内容 · {backup.manifest.categories.length} 个类别 · {imageCount} 张原图</span>
              <span>解压后原图约 {formatBytes(backup.totalBytes)}</span>
            </div>
          )}
          <div className="restore-modes" role={theme === 'animal-island' ? undefined : 'radiogroup'} aria-label="恢复方式">
            {theme === 'animal-island' ? (
              <Radio
                value={mode}
                direction="vertical"
                options={[
                  { value: 'merge', label: <span className="restore-mode-copy"><strong>安全合并</strong><small>保留现有内容，重复项跳过。</small></span> },
                  { value: 'replace', label: <span className="restore-mode-copy"><strong>完整覆盖</strong><small>先自动备份当前内容，再替换数据。</small></span> }
                ]}
                onChange={(value) => setMode(value as 'merge' | 'replace')}
              />
            ) : (
              <>
                <label>
                  <input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  <span className="restore-mode-copy"><strong>安全合并</strong><small>保留现有内容，重复项跳过。</small></span>
                </label>
                <label>
                  <input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span className="restore-mode-copy"><strong>完整覆盖</strong><small>先自动备份当前内容，再替换数据。</small></span>
                </label>
              </>
            )}
          </div>
          <Button disabled={!backup || busy} danger={mode === 'replace'} icon={<AppIcon name="restore" size={18} />} onClick={() => void runRestore()}>
            {mode === 'replace' ? '生成安全备份并完整覆盖' : '开始安全合并'}
          </Button>
        </BackupPanel>
      </div>

      {report && (
        <div className="restore-report">
          <strong>恢复报告：新增 {report.added} · 跳过 {report.skipped} · 失败 {report.failed.length}</strong>
          {report.failed.length > 0 && (
            <ul>{report.failed.slice(0, 20).map((entry, index) => <li key={index}>{entry.title}：{entry.error}</li>)}</ul>
          )}
        </div>
      )}
    </BackupSection>
  )
}
