import { DataGrid, DataGridProps, GridColDef, GridValidRowModel, useGridApiRef } from '@mui/x-data-grid'
import { Alert, Box, BoxProps, Breakpoint, LinearProgress, useTheme } from '@mui/material'
import { useWindowSize } from 'usehooks-ts'
import { createElement as h, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { newDialog, onlyTruthy } from '@hfs/shared'
import _ from 'lodash'
import { Center, Flex } from './misc'

const ACTIONS = 'Actions'

interface DataTableProps<R extends GridValidRowModel=any> extends Omit<DataGridProps<R>, 'columns'> {
    columns: Array<GridColDef<R> & {
        hidden?: boolean
        hideUnder?: Breakpoint | number
        mergeRender?: { other: string, override?: Partial<GridColDef<R>> } & BoxProps
    }>
    actions?: ({ row, id }: any) => ReactNode[]
    actionsProps?: Partial<GridColDef<R>> & { hideUnder?: Breakpoint | number }
    initializing?: boolean
    noRows?: ReactNode
    error?: ReactNode
}
export function DataTable({ columns, initialState={}, actions, actionsProps, initializing, noRows, error, ...rest }: DataTableProps) {
    const { width } = useWindowSize()
    const theme = useTheme()
    const apiRef = useGridApiRef()
    const [actionsLength, setActionsLength] = useState(0)
    const manipulatedColumns = useMemo(() => {
        const ret = columns.map(col => {
            const { mergeRender } = col
            if (!mergeRender)
                return col
            const { other, override, ...props } = mergeRender
            return {
                ...col,
                originalRenderCell: col.renderCell || true,
                renderCell(params: any) {
                    const { columns } = params.api.store.getSnapshot()
                    const showOther = columns.columnVisibilityModel[other] === false
                    return h(Box, {}, col.renderCell ? col.renderCell(params) : params.formattedValue,
                        showOther && h(Box, props, renderCell({ ...columns.lookup[other], ...override }, params.row)))
                }
            }
        })
        if (actions)
            ret.push({
                field: ACTIONS,
                width: 40 * actionsLength,
                headerName: '',
                align: 'center',
                headerAlign: 'center',
                hideSortIcons: true,
                disableColumnMenu: true,
                renderCell(params: any) {
                    const ret = actions({ ...params.row, ...params })
                    setTimeout(() => setActionsLength(ret.length)) // cannot update state during rendering
                    return h(Box, { whiteSpace: 'nowrap' }, ...ret)
                },
                ...actionsProps
            })
        return ret
    }, [columns, actions, actionsLength])
    const hideCols = useMemo(() => {
        if (!width) return
        const fields = onlyTruthy(manipulatedColumns.map(({ field, hideUnder, hidden }) =>
            (hidden || hideUnder && width < (typeof hideUnder === 'number' ? hideUnder : theme.breakpoints.values[hideUnder]))
            && field))
        const o = Object.fromEntries(fields.map(x => [x, false]))
        _.merge(initialState, { columns: { columnVisibilityModel: o } })
        return fields
    }, [manipulatedColumns])
    const [vis, setVis] = useState({})

    const displayingDetails = useRef<any>({})
    useEffect(() => {
        const { current: { id, setCurRow } } = displayingDetails
        setCurRow?.(_.find(rest.rows, { id }))
    })

    if (!hideCols) // only first time we render, initialState is considered, so wait
        return null

    return h(Fragment, {},
        error && h(Alert, { severity: 'error' }, error),
        initializing && h(Box, { position: 'relative' },
            h(LinearProgress, { // differently from "loading", this is not blocking user interaction
                sx: { position: 'absolute', width: 'calc(100% - 2px)', borderRadius: 1, m: '1px 1px' }
            }) ),
        h(DataGrid, {
            initialState,
            style: { height: 0, flex: 'auto' }, // limit table to available screen space
            columns: manipulatedColumns,
            apiRef,
            slots: {
                ...(noRows || initializing) && { noRowsOverlay: () => initializing ? null : h(Center, {}, noRows) },
            },
            onCellClick({ field, row }) {
                if (field === ACTIONS) return
                const n = apiRef.current.getVisibleColumns().length
                const showCols = manipulatedColumns.filter(x =>
                    x.renderCell || x.field === ACTIONS || row[x.field] !== undefined)
                if (showCols.length <= n) return
                newDialog({
                    title: "Details",
                    onClose() {
                        displayingDetails.current = {}
                    },
                    Content() {
                        const [curRow, setCurRow] = useState(row)
                        const keepRow = useRef(row)
                        if (curRow)
                            keepRow.current = curRow
                        const rowToShow = keepRow.current
                        displayingDetails.current = { id: rowToShow.id, setCurRow }
                        return h(Box, {
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8em,1fr))', gap: '1em',
                            gridAutoFlow: 'dense',
                            minWidth: 'max(16em, 40vw)',
                            sx: { opacity: curRow ? undefined : .5 },
                        }, showCols.map(col =>
                            h(Box, { key: col.field, gridColumn: col.flex && '1/-1' },
                                h(Box, { bgcolor: '#0003', p: 1 }, col.headerName || col.field),
                                h(Flex, { minHeight: '2.5em', px: 1, wordBreak: 'break-word' },
                                    renderCell(col, rowToShow) )
                            ) ))
                    }
                })
            },
            ...rest,
            onColumnVisibilityModelChange: x => setVis(x),
            columnVisibilityModel: {
                ...Object.fromEntries(hideCols.map(x => [x, false])),
                ...rest.columnVisibilityModel,
                ...vis,
            }
        })
    )

    function renderCell(col: GridColDef, row: any) {
        const api = apiRef.current
        let value = row[col.field]
        if (col.valueGetter)
            value = col.valueGetter({ value, api, row, field: col.field, id: row.id } as any)
        const render = (col as any).originalRenderCell || col.renderCell
        return render && render !== true ? render({ value, row, api, ...row })
            : col.valueFormatter ? col.valueFormatter({ value, ...row })
                : value
    }
}
