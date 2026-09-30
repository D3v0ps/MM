// MB:s komponentbibliotek – samma i riktiga appen och i prototypen. Dokumentation: src/ui/README.md.
// Inga next/*-importer här: koden körs även i prototypen (Vite). Länkar via Link från @/shell/nav.
export { cn } from "./cn";
export { Icon, ICON_NAMES, type IconName, type IconProps, type IconSize } from "./icons";
export { AreaProvider, useArea, useAreaAttr, type LayoutArea } from "./area";
export { Stack, Row, Spacer, Grid, Split, FormGrid, Divider, Eyebrow, Dot, Brand, List, ListItem, IconText, type ListItemProps } from "./layout";
export { Page, Card, Section, type PageProps, type CardProps, type Crumb } from "./page";
export { Button, Btn, buttonVariants, type ButtonProps, type ButtonKind } from "./button";
export {
  Badge,
  Status,
  CaseStatusBadge,
  SlaBadge,
  PhaseBar,
  PhaseTag,
  BuildPhase,
  AiTag,
  AiBox,
  Evidence,
  RecIndicator,
  STATUS_TEXT,
  STATUS_SHORT,
  STATUS_ICON,
  type BadgeTone,
  type RagStatus,
  type CaseStatusValue,
  type SlaTone,
  type SlaView,
} from "./badge";
export { Table, CellSub, type Column, type RowTone, type TableProps } from "./table";
export { Field, Input, Select, TextArea, Check, Seg, DateInput, TimeInput, DateTimeInput, type FieldProps, type SelectOption, type SegOption } from "./form";
export { Tabs, TabPanel, type TabDef } from "./tabs";
export { Modal, Drawer, ConfirmHost, TextDialogHost, useConfirm, confirmDialog, useTextDialog, showText, type ModalProps, type ConfirmOptions } from "./dialog";
export { Notice, DemoNote, Empty, Loading, ErrorNotice, QueryView, type NoticeTone, type QueryLike } from "./feedback";
export { Toaster, toast, useToast, type ToastTone } from "./toast";
export { DownloadProvider, useDownload, useCopy, blobDownload, type DownloadImpl, type DownloadFile } from "./download";
export { Kpi, Meter, Kv, Timeline, Stepper, Avatar, UserName, Chart, type MeterMarker, type TimelineItem } from "./data";
export { Paper, PaperFixedText, XBox, type PaperProps } from "./paper";
export { BigButtons, BigButton, PulsePhone, Smileys, Smiley, type BigButtonProps } from "./portal";
export { CaseLink, casePathFor, MaskedPnr, PerspectiveLink, useAuditView } from "./case";
