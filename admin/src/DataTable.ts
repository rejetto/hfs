import { DataGrid, DataGridProps, enUS, getGridStringOperators, GridColDef, GridFooter, GridFooterContainer,
    GridValidRowModel, useGridApiRef } from '@mui/x-data-grid'
import { Alert, Box, BoxProps, Breakpoint, LinearProgress, useTheme } from '@mui/material'
import { useWindowSize } from 'usehooks-ts'
import { createElement as h, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { newDialog, onlyTruthy } from '@hfs/shared'
import _ from 'lodash'
import { Center, Flex, useBreakpoint } from './mui'
import { SxProps } from '@mui/system'

const ACTIONS = 'Actions'

export type DataTableColumn<R extends GridValidRowModel=any> = GridColDef<R> & {
    hidden?: boolean
    hideUnder?: Breakpoint | number
    dialogHidden?: boolean
    sx?: SxProps
    mergeRender?: { [other: string]: false | { override?: Partial<GridColDef<R>> } & BoxProps }
}
interface DataTableProps<R extends GridValidRowModel=any> extends Omit<DataGridProps<R>, 'columns'> {
    columns: Array<DataTableColumn<R>>
    actions?: ({ row, id }: any) => ReactNode[]
    actionsProps?: Partial<GridColDef<R>> & { hideUnder?: Breakpoint | number }
    initializing?: boolean
    noRows?: ReactNode
    error?: ReactNode
    compact?: true
    addToFooter?: ReactNode
}
export function DataTable({ columns, initialState={}, actions, actionsProps, initializing, noRows, error, compact, addToFooter, ...rest }: DataTableProps) {
    let { width } = useWindowSize()
    width = Math.min(width, screen.availWidth) // workaround: width returned by useWindowSize is not good when toggling mobile-mode in chrome
    const theme = useTheme()
    const apiRef = useGridApiRef()
    const [actionsLength, setActionsLength] = useState(0)
    const manipulatedColumns = useMemo(() => {
        const { localeText } = enUS.components.MuiDataGrid.defaultProps as any
        const ret = columns.map(col => {
            const { type, sx } = col
            if (!type || type === 'string') // offer negated version of default string operators
                col.filterOperators ??= getGridStringOperators().flatMap(op => op.value.includes('Empty') ? op : [ // isEmpty already has isNotEmpty
                    op,
                    {
                        ...op,
                        value: '!' + op.value,
                        getApplyFilterFn(item, col) {
                            const res = op.getApplyFilterFn(item, col)
                            return res && _.negate(res)
                        },
                        ...op.getApplyFilterFnV7 && { getApplyFilterFnV7(item, col) {
                            const res = op.getApplyFilterFnV7?.(item, col)
                            return res ? _.negate(res) : null
                        } },
                        label: "(not) " + (localeText['filterOperator' + _.upperFirst(op.value)] || op.value)
                    } satisfies typeof op
                ])
            if (!col.mergeRender)
                return col
            return {
                ...col,
                originalRenderCell: col.renderCell || true,
                renderCell(params: any) {
                    const { columns } = params.api.store.getSnapshot()
                    return h(Box, { maxHeight: '100%', sx: { textWrap: 'wrap', ...sx } }, // wrap if necessary, but stay within the row
                        col.renderCell ? col.renderCell(params) : params.formattedValue,
                        h(Flex, { fontSize: 'smaller', flexWrap: 'wrap', mt: '2px' }, // wrap, normally causing overflow/hiding, if it doesn't fit
                            ...onlyTruthy(_.map(col.mergeRender, (props, other) => {
                                if (!props || columns.columnVisibilityModel[other] !== false) return null
                                const { override, ...rest } = props
                                const rendered = renderCell({ ...columns.lookup[other], ...override }, params.row)
                                return rendered && h(Box, { ...rest, ...compact && { lineHeight: '1em' } }, rendered)
                            }))
                        )
                    )
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
    }, [manipulatedColumns, width])
    const [vis, setVis] = useState({})

    const displayingDetails = useRef<any>({})
    useEffect(() => {
        const { current: { id, setCurRow } } = displayingDetails
        setCurRow?.(_.find(rest.rows, { id }))
    })
    const sm = useBreakpoint('sm')

    if (!hideCols) // only first time we render, initialState is considered, so wait
        return null

    return h(Fragment, {},
        error && h(Alert, { severity: 'error' }, error),
        initializing && h(Box, { position: 'relative' },
            h(LinearProgress, { // differently from "loading", this is not blocking user interaction
                sx: { position: 'absolute', width: 'calc(100% - 2px)', borderRadius: 1, m: '1px 1px' }
            }) ),
        h(DataGrid, {
            key: width,
            initialState,
            style: { height: 0, flex: 'auto' }, // limit table to available screen space
            density: compact ? 'compact' : 'standard',
            columns: manipulatedColumns,
            apiRef,
            ...rest,
            slots: {
                noRowsOverlay: () => initializing ? null : h(Center, {}, noRows || "No entries"),
                footer: CustomFooter,
            },
            slotProps: {
                footer: { add: addToFooter } as any,
                pagination: !sm && addToFooter ? undefined : {
                    showFirstButton: true,
                    showLastButton: true,
                },
            },
            onCellClick({ field, row }) {
                if (field === ACTIONS) return
                if (window.getSelection()?.type === 'Range') return // not a click but a drag
                const n = apiRef.current.getVisibleColumns().length
                const showCols = manipulatedColumns.filter(x =>
                    !x.dialogHidden && (x.renderCell || x.field === ACTIONS || row[x.field] !== undefined))
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

function CustomFooter({ add, ...props }: { add: ReactNode }) {
    return h(GridFooterContainer, props, h(Box, { ml: { sm: 1 } }, add), h(GridFooter, { sx: { border: 'none' } }))
}
