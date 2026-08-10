import { Pipe, PipeTransform } from '@angular/core';
import { formatFileSize } from '../util/format-file-size';

@Pipe({
  name: 'fileSize',
})
export class FileSizePipe implements PipeTransform {
  transform(value: number): string {
    return formatFileSize(value);
  }
}
