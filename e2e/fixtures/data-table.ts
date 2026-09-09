import { createElement as h, useState } from 'react'
import { DataTable } from '../../admin/src/DataTable'

type Row = { key: string, id: string, label: string, extra: string }
declare global {
    interface Window {
        customTableId: boolean
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
        columns: [{ field: 'label', headerName: 'Label' }, { field: 'extra', headerName: 'Extra', hideUnder: true,
            renderCell: ({ id, value }) => `${id}: ${value}` }],
        sx: { height: 300 },
    })
}
