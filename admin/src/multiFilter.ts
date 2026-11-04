import type { RefObject } from 'react'
import { GridLogicOperator, type GridApi, type GridColDef, type GridFilterItem, type GridFilterModel, type GridValidRowModel } from '@mui/x-data-grid'

export function applyMultiFilter<R extends GridValidRowModel>(
    rows: readonly R[], model: GridFilterModel, apiRef: RefObject<GridApi | null>
) {
    if (!apiRef.current) return rows
    const activeApiRef = apiRef as { current: GridApi }
    const filters = activeMultiFilters<R>(model, activeApiRef)
    if (!filters.length) return rows
    return rows.filter(row => {
        return model.logicOperator === GridLogicOperator.Or ? filters.some(matches) : filters.every(matches)

        function matches({ column, apply }: typeof filters[number]) {
            // MUI leaves the raw value generic unresolved in GridColDef, although it supplies it at runtime
            const valueGetter = column.valueGetter as ActiveFilter<R>['valueGetter']
            const value = valueGetter
                ? valueGetter(row[column.field], row, column, activeApiRef.current)
                : row[column.field]
            return apply(value, row, column, activeApiRef)
        }
    })
}

export function countActiveMultiFilters(field: string | undefined, model: GridFilterModel, apiRef: RefObject<GridApi | null>) {
    return apiRef.current
        ? activeMultiFilters(model, apiRef as { current: GridApi }).filter(x => field === undefined || x.item.field === field).length
        : 0
}

function activeMultiFilters<R extends GridValidRowModel>(model: GridFilterModel, apiRef: { current: GridApi }) {
    return model.items.flatMap(item => {
        const column = apiRef.current.getColumn(item.field) as GridColDef<R> | null
        const operator = column?.filterOperators?.find(({ value }) => value === item.operator)
        const apply = column && operator?.getApplyFilterFn(item, column) as ActiveFilter<R>['apply'] | null
        return column && apply ? [{ item, column, apply }] : []
    })
}

type ActiveFilter<R extends GridValidRowModel> = {
    item: GridFilterItem
    apply: (value: unknown, row: R, column: GridColDef<R>, apiRef: { current: GridApi }) => boolean
    valueGetter?: (value: unknown, row: R, column: GridColDef<R>, api: GridApi) => unknown
}
