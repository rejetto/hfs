import { createElement as h, useState } from 'react'
import { DataTable } from '../../admin/src/DataTable'

type Row = { key: string, id: string, label: string, extra: string }
declare global {
    interface Window {
        customTableId: boolean
        showTableActions: boolean
        hideTableExtra: boolean
        mergeTableExtra: boolean
        updateTableRows: () => void
    }
}

export default function DataTableFixture() {
    const [rows, setRows] = useState<Row[]>(['first', 'second'].map(key => ({
        key, id: window.customTableId ? 'duplicate-data-id' : key, label: key, extra: `${key} details`,
    })))
    window.updateTableRows = () => setRows(rows.map(row => ({ ...row, label: `${row.key} updated` })))
    return h(DataTable, {
        rows,
        getRowId: window.customTableId ? row => row.key : undefined,
        columns: [
            { field: 'label', headerName: 'Label', mergeRender: window.mergeTableExtra ? { extra: {} } : undefined },
            { field: 'extra', headerName: 'Extra', hideUnder: window.hideTableExtra !== false,
                renderCell: ({ id, value }) => `${id}: ${value}` },
            ...window.showTableActions ? [{ field: '', type: 'actions' as const, getActions: () => [] }] : [],
        ],
        sx: { height: 300 },
    })
}
