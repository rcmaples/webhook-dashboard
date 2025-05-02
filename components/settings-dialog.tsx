"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings } from "lucide-react"

interface WebhookSettings {
  projectId: string
  webhookId: string
}

interface SettingsDialogProps {
  settings: WebhookSettings
  onSave: (settings: WebhookSettings) => void
  onReset: () => void
}

export function SettingsDialog({ settings, onSave, onReset }: SettingsDialogProps) {
  const [projectId, setProjectId] = useState(settings.projectId)
  const [webhookId, setWebhookId] = useState(settings.webhookId)
  const [open, setOpen] = useState(false)

  // Reset form values when dialog opens or settings change
  useEffect(() => {
    if (open) {
      setProjectId(settings.projectId)
      setWebhookId(settings.webhookId)
    }
  }, [open, settings])

  const handleSave = () => {
    onSave({
      projectId: projectId.trim(),
      webhookId: webhookId.trim(),
    })
    setOpen(false)
  }

  const handleReset = () => {
    onReset()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-1">
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Webhook Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="projectId">Project ID</Label>
            <Input
              id="projectId"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="e.g. czqk28jt"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="webhookId">Webhook ID</Label>
            <Input
              id="webhookId"
              value={webhookId}
              onChange={(e) => setWebhookId(e.target.value)}
              placeholder="e.g. g9qVzHvYoAWPfivG"
            />
          </div>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button onClick={handleSave} disabled={!projectId || !webhookId}>
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
