import { DataGrid, DataGridProps, enUS, getGridStringOperators, GridColDef, GridFooter, GridFooterContainer,
    GridValidRowModel, useGridApiRef, GridRenderCellParams } from '@mui/x-data-grid'
import { Alert, Box, BoxProps, Breakpoint, LinearProgress, useTheme } from '@mui/material'
import { createElement as h, Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callable, Callback, Falsy, newDialog, onlyTruthy, useGetSize } from '@hfs/shared'
import _ from 'lodash'
import { Center, Flex } from './mui'
import { SxProps } from '@mui/system'
import { state, updateStateObject } from './state'
import { useDebounce } from 'usehooks-ts'

const ACTIONS = 'Actions'

export type DataTableColumn<R extends GridValidRowModel=any> = GridColDef<R> & {
    hideUnder?: Breakpoint | number | boolean
    dialogHidden?: boolean
    sx?: SxProps | Callback<GridRenderCellParams, SxProps>
    mergeRender?: { [other: string]: false | { override?: Partial<GridColDef<R>> } & BoxProps }
    mergeRenderSx?: SxProps
}
export interface DataTableProps<R extends GridValidRowModel=any> extends Omit<DataGridProps<R>, 'columns'> {
    columns: Array<DataTableColumn<R> | Falsy>
    actions?: ({ row, id }: any) => ReactNode[]
    actionsProps?: Partial<GridColDef<R>> & { hideUnder?: Breakpoint | number }
    initializing?: boolean
    noRows?: ReactNode
    error?: ReactNode
    compact?: boolean
    footerSide?: (width: number) => ReactNode
    fillFlex?: boolean
    persist?: string
    details?: boolean
}
export function DataTable({ columns, initialState={}, actions, actionsProps, initializing, noRows, error, compact, footerSide, fillFlex, persist, details, ...rest }: DataTableProps) {
    const theme = useTheme()
    const apiRef = useGridApiRef()
    const [actionsLength, setActionsLength] = useState(0)
    const [merged, setMerged] = useState(0)
    const manipulatedColumns = useMemo(() => {
        const { localeText } = enUS.components.MuiDataGrid.defaultProps as any
        const ret = onlyTruthy(columns.map(col => {
            if (!col) return
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
            if (!col.mergeRender && !col.sx)
                return col
            return {
                ...col,
                originalRenderCell: col.renderCell || true,
                renderCell(params: any) {
                    const { columns } = params.api.store.getSnapshot()
                    return h(Box, { maxHeight: '100%', sx: { textWrap: 'wrap', ...callable(sx as any, params) } }, // wrap if necessary, but stay within the row
                        col.renderCell ? col.renderCell(params) : params.formattedValue,
                        col.mergeRender && h(Flex, { fontSize: 'smaller', flexWrap: 'wrap', mt: '2px', rowGap: 0, ...col.mergeRenderSx }, // wrap, normally causing overflow/hiding, if it doesn't fit
                            ...onlyTruthy(_.map(col.mergeRender, (props, other) => {
                                if (!props || columns.columnVisibilityModel[other] !== false) return null
                                const rendered = renderCell({ ...columns.lookup[other], ...props.override }, params.row)
                                return rendered && h(Box, { ...props, ...{ override: undefined }, ...compact && { lineHeight: '1em' } }, rendered)
                            }))
                        )
                    )
                }
            }
        }))
        if (actions)
            ret.unshift({
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
    const sizeGrid = useGetSize()
    const width = useDebounce(sizeGrid.w || 0, 500) // stabilize width
    const hideCols = useMemo(() => {
        const fields = onlyTruthy(manipulatedColumns.map(({ field, hideUnder }) =>
            (hideUnder === true || hideUnder && width < (typeof hideUnder === 'number' ? hideUnder : theme.breakpoints.values[hideUnder]))
            && field))
        const o = Object.fromEntries(fields.map(x => [x, false]))
        _.merge(initialState, { columns: { columnVisibilityModel: o } })
        // count the hidden columns that are merged into visible columns
        setMerged(_.sumBy(fields, k => _.find(columns, col => col && !fields.includes(col.field) && col.mergeRender?.[k]) ? 1 : 0))
        return fields
    }, [manipulatedColumns, width])
    const [vis, setVis] = useState(persist && state.dataTablePersistence[persist]?.columnVisibility || {})

    const displayingDetails = useRef<any>({})
    useEffect(() => {
        const { current: { id, setCurRow } } = displayingDetails
        setCurRow?.(_.find(rest.rows, { id }))
    })
    const sizeFooterSide = useGetSize()
    const wrappedFooterSide = h(Box, {
        ref: sizeFooterSide.refToPass,
        className: 'footerSide',
        sx: { whiteSpace: 'nowrap' }
    }, footerSide?.(width))
    const [causingScrolling, setCausingScrolling] = useState(false)
    const updateCausingScrolling = useCallback(_.debounce(() => {
        const el = sizeGrid.ref.current?.querySelector('.MuiTablePagination-root')
        setCausingScrolling(el && (el.scrollWidth > el.clientWidth) || false)
    }, 500), [sizeGrid])
    useEffect(updateCausingScrolling, [sizeGrid, width, sizeFooterSide.w]) // recalculate in case the footerSide changes

    return h(Fragment, {},
        error && h(Alert, { severity: 'error' }, error),
        initializing && h(Box, { position: 'relative' },
            h(LinearProgress, { // differently from "loading", this is not blocking user interaction
                sx: { position: 'absolute', width: 'calc(100% - 2px)', borderRadius: 1, m: '1px 1px' }
            }) ),
        h(DataGrid, {
            key: width,
            initialState,
            density: compact ? 'compact' : 'standard',
            columns: manipulatedColumns,
            apiRef,
            disableRowSelectionOnClick: true,
            ref: sizeGrid.refToPass,
            ...rest,
            sx: {
                ...fillFlex && { height: 0, flex: 'auto' }, // limit table to available screen space, if parent is flex. Consider using fillFlexParentSx
                '& .MuiDataGrid-virtualScroller': { minHeight: '3em' }, // without this, no-entries gets just 1px
                '& .MuiTablePagination-root': { scrollbarWidth: 'none'},
                ...rest.sx,
            },
            slots: {
                noRowsOverlay: () => initializing ? null : h(Center, {}, noRows || "No entries"),
                footer: CustomFooter,
            },
            slotProps: {
                footer: { add: wrappedFooterSide } as any, // 'add' is introduced by CustomFooter
                pagination: {
                    labelRowsPerPage: "Rows",
                    ...!causingScrolling && {
                        showFirstButton: true,
                        showLastButton: true,
                    }
                },
            },
            onCellClick({ field, row }) {
                if (field === ACTIONS || details === false) return
                if (window.getSelection()?.type === 'Range') return // not a click but a drag
                const visibleInList = merged + apiRef.current.getVisibleColumns().length
                const showInDialog = manipulatedColumns.filter(x =>
                    !x.dialogHidden && (x.renderCell || x.field === ACTIONS || row[x.field] !== undefined))
                if (showInDialog.length <= visibleInList) return // no need for dialog
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
                        }, showInDialog.map(col =>
                            h(Box, { key: col.field, gridColumn: col.flex! >= 1 ? '1/-1' : undefined },
                                h(Box, { bgcolor: '#0003', p: 1 }, col.headerName || col.field),
                                h(Flex, { minHeight: '2.5em', px: 1, wordBreak: 'break-word', flexWrap: 'wrap' },
                                    renderCell(col, rowToShow) )
                            ) ))
                    }
                })
            },
            onColumnVisibilityModelChange: vis => {
                setVis(vis)
                if (!persist) return
                updateStateObject(state, 'dataTablePersistence', x => {
                    x[persist] = {
                        columnVisibility: _.omitBy(vis, (v, k) => hideCols.includes(k) === (v === false))
                    }
                })
            },
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

// required in case of fillFlex:true
export const fillFlexParentSx = { display: 'flex', flexDirection: 'column' } as const